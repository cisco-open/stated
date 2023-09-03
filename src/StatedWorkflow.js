// Copyright 2023 Cisco Systems, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
const TemplateProcessor = require('./TemplateProcessor');
const express = require('express');

//This class is a wrapper around the TemplateProcessor class that provides workflow functionality
class StatedWorkflow {
    static express = require('express');
    static app = express();
    static port = 3000;

    static newWorkflow(template) {
        this.context = {
            "id": StatedWorkflow.generateDateAndTimeBasedID.bind(this),
            "serial": StatedWorkflow.serial.bind(this),
            "parallel": StatedWorkflow.parallel.bind(this),
            "nextCloudEvent": StatedWorkflow.nextCloudEvent.bind(this),
            "onHttp": StatedWorkflow.onHttp.bind(this),
            "subscribe": StatedWorkflow.subscribe.bind(this),
            "logFunctionInvocation": StatedWorkflow.logFunctionInvocation.bind(this)
        };
        const templateProcessor = new TemplateProcessor(template, this.context);
        templateProcessor.logLevel = "debug";
        return templateProcessor;
    }

    static async logFunctionInvocation(stage, args, result, error = null, log) {
        const logMessage = {
            context: stage.name,
            function: stage.function.name,
            start: new Date().toISOString(),
            args: args
        };

        if (error) {
            logMessage.error = {
                timestamp: new Date().toISOString(),
                message: error.message
            };
        } else {
            logMessage.finish = new Date().toISOString();
            logMessage.out = result;
        }
        console.log(JSON.stringify(logMessage));

        // Assuming 'logs' array is inside 'log' object
        if (log.logs) {
            log.logs.push(logMessage);
        } else {
            log.logs = [logMessage];
        }
    }

    // static async logFunctionInvocation(stage, args, result, error = null, logMessage) {
    //     logMessage = {
    //         context: stage.name,
    //         function: stage.function.name,
    //         start: new Date().toISOString(),
    //         args: args
    //     };
    //     if (error) {
    //         logMessage.error = {
    //             timestamp: new Date().toISOString(),
    //             message: error.message
    //         };
    //     } else {
    //         logMessage.finish = new Date().toISOString();
    //         logMessage.out = result;
    //     }
    //     console.log(JSON.stringify(logMessage));
    //     log.add(logMessage);
    // }

    static async subscribe(params) {
        const {source} = params;
        if(source === 'http'){
            return StatedWorkflow.onHttp(params);
        }
        if(source === 'cloudEvent' || source === 'data'){
            return StatedWorkflow.nextCloudEvent(params);
        }
        if(!source){
            throw new Error("Subscribe source not set");
        }
        throw new Error(`Unknown subscribe source ${source}`);
    }

    static async nextCloudEvent(subscriptionParams) {
        const dispatcher = new WorkflowDispatcher(
            subscriptionParams.to,
            subscriptionParams.parallelism
        );

        dispatcher.addBatch(subscriptionParams.testData);
        // Wait for all workflows to complete (since this is test data) before returning
        await dispatcher.drainBatch();
    }

    static onHttp(subscriptionParams) {
        const dispatcher = new WorkflowDispatcher(
            subscriptionParams.to,
            subscriptionParams.parallelism
        );

        StatedWorkflow.app.all('*', (req, res) => {
            // Push the request and response objects to the dispatch queue to be handled by callback
            dispatcher.addToQueue({ req, res });
        });

        StatedWorkflow.app.listen(StatedWorkflow.port, () => {
            console.log(`Server started on http://localhost:${StatedWorkflow.port}`);
        });


    }

    static async serial(input, steps, options) {
        const {name:workflowName, log} = options;
        let {id} = options;

        if(log === undefined){
            throw new Error('log is missing from options');
        }

        if(id === undefined){
            id = this.generateUniqueId();
            options.id = id;
        }

        this.initializeLog(log, workflowName, id);

        let currentInput = input;
        for (let step of steps) {
            currentInput = await this.executeStep(step, currentInput, log[workflowName][id]);
        }

        this.finalizeLog(log[workflowName][id]);
        this.ensureRetention(log[workflowName]);

        return currentInput;
    }

    static generateUniqueId() {
        return `${new Date().getTime()}-${Math.random().toString(36).slice(2, 7)}`;
    }

    static initializeLog(log, workflowName, id) {
        log[workflowName] = log[workflowName] || {};
        log[workflowName][id] = {
            info: {
                start: new Date().getTime(),
                status: 'in-progress'
            },
            execution: []
        };
    }

    static async executeStep(step, input, currentLog) {
        const stepLog = {
            step: step.name,
            start: new Date().getTime(),
            args: [input]
        };

        try {
            const result = await step.function.apply(this, [input]);
            stepLog.end = new Date().getTime();
            stepLog.out = result;
            currentLog.execution.push(stepLog);
            return result;
        } catch (error) {
            stepLog.end = new Date().getTime();
            stepLog.error = { message: error.message };
            currentLog.info.status = 'failed';
            currentLog.execution.push(stepLog);
            throw error;
        }
    }

    static finalizeLog(currentLog) {
        currentLog.info.end = new Date().getTime();
        if (currentLog.info.status !== 'failed') {
            currentLog.info.status = 'succeeded';
        }
    }

    static ensureRetention(workflowLogs) {
        const maxLogs = 100;
        const sortedKeys = Object.keys(workflowLogs).sort((a, b) => workflowLogs[b].info.start - workflowLogs[a].info.start);
        while (sortedKeys.length > maxLogs) {
            const oldestKey = sortedKeys.pop();
            delete workflowLogs[oldestKey];
        }
    }


    //This function is called by the template processor to execute an array of stages in parallel
    static async parallel(initialInput, stages, log) {
        let promises = [];

        for (let stage of stages) {
            if (stage.output.results.length > 0 || stage.output.errors.length > 0) {
                //if we have already run this stage, skip it
                continue;
            }

            const promise = stage.function.apply(this, [initialInput])
                .then(result => {
                    stage.output.results.push(result);
                    return result;
                })
                .catch(error => {
                    stage.output.errors.push(error);
                    return error;
                });

            promises.push(promise);
        }

        return await Promise.all(promises);
    }

    static generateDateAndTimeBasedID() {
        const date = new Date();
        const dateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
        const timeInMs = date.getTime();
        const randomPart = Math.random().toString(36).substring(2, 6);  // 4 random characters for added uniqueness

        return `${dateStr}-${timeInMs}-${randomPart}`;
    }
}

class WorkflowDispatcher {
    constructor(workflowFunction, parallelism) {
        this.workflowFunction = workflowFunction;
        this.parallelism = parallelism || 1;
        this.queue = [];
        this.active = 0;
        this.promises = [];
        this.batchMode = false;
        this.batchCount = 0; // Counter to keep track of items in the batch
    }

    _dispatch() {
        while (this.active < this.parallelism && this.queue.length > 0) {
            this.active++;
            const eventData = this.queue.shift();

            const promise = this.workflowFunction.apply(null, [eventData])
                .catch(error => {
                    console.error("Error executing workflow:", error);
                })
                .finally(() => {
                    this.active--;
                    if (this.batchMode) {
                        this.batchCount--;
                    }
                    const index = this.promises.indexOf(promise);
                    if (index > -1) {
                        this.promises.splice(index, 1);
                    }
                    this._dispatch();
                });

            this.promises.push(promise);
        }
    }

    addToQueue(data) {
        this.queue.push(data);
        this._dispatch();
    }

    //this is used for testing
    addBatch(dataArray) {
        this.batchMode = true;
        this.batchCount += dataArray.length;
        dataArray.forEach(data => this.addToQueue(data));
    }

    //this is used for testing
    async drainBatch() {
        while (this.batchMode && this.batchCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 50)); // Poll every 50ms
        }
        this.batchMode = false;
    }
}



module.exports = StatedWorkflow;

