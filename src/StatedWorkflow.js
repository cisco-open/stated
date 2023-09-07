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
const Pulsar = require('pulsar-client');
const winston = require("winston");
const stated = require("../stated");

//This class is a wrapper around the TemplateProcessor class that provides workflow functionality
class StatedWorkflow {
    static express = require('express');
    static app = express();
    static port = 3000;
    static logger = winston.createLogger({
        format: winston.format.json(),
        transports: [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.simple()
                )
            })
        ],
    });

    static newWorkflow(template) {
        this.context = {
            "id": StatedWorkflow.generateDateAndTimeBasedID.bind(this),
            "serial": StatedWorkflow.serial.bind(this),
            "parallel": StatedWorkflow.parallel.bind(this),
            "nextCloudEvent": StatedWorkflow.nextCloudEvent.bind(this),
            "onHttp": StatedWorkflow.onHttp.bind(this),
            "subscribe": StatedWorkflow.subscribe.bind(this),
            "publish": StatedWorkflow.pulsarPublish.bind(this),
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

    static async subscribe(subscribeOptions) {
        const {source} = subscribeOptions;
        this.logger.debug(`subscribing ${stated.stringify(source)}`);
        if (source === 'http') {
            return StatedWorkflow.onHttp(subscribeOptions);
        }
        if (source === 'cloudEvent' || source === 'data') {
            return StatedWorkflow.nextCloudEvent(subscribeOptions);
        }
        if (!source) {
            throw new Error("Subscribe source not set");
        }
        throw new Error(`Unknown subscribe source ${source}`);
    }

    static pulsarClient = new Pulsar.Client({
        serviceUrl: 'pulsar://localhost:6650',
    });
    static consumers = new Map(); //key is type, value is pulsar consumer
    static dispatchers = new Map(); //key is type, value Set of WorkflowDispatcher

    static pulsarPublish(params) {
        this.logger.debug(`pulsar publish params ${stated.stringify(params)}`);
        const {type, data} = params;
        (async () => {


            // Create a producer
            const producer = await this.pulsarClient.createProducer({
                topic: type,
            });

            try {
                let _data = data;
                if (data._jsonata_lambda === true) {
                    _data = await data.apply(this, []); //data is a function, call it
                }
                this.logger.debug(`pulsar producer sending ${stated.stringify(_data)}`);
                // Send a message
                const messageId = await producer.send({
                    data: Buffer.from(JSON.stringify(_data, null, 2)),
                });
            }finally {
                // Close the producer and client when done
                producer.close();
            }
        })();

    }

    static pulsarSubscribe(subscriptionParams) {
        const {type, initialPosition = 'earliest', maxConsume = -1} = subscriptionParams;
        this.logger.debug(`pulsar subscribe params ${stated.stringify(subscriptionParams)}`);
        let consumer, dispatcher;
        //make sure a dispatcher exists for the combination of type and subscriberId
        WorkflowDispatcher.getDispatcher(subscriptionParams);
        // Check if a consumer already exists for the given subscription
        if (StatedWorkflow.consumers.has(type)) {
            this.logger.debug(`pulsar subscriber already started. Bail.`);
            return; //bail, we are already consuming and dispatching this type
        }
        (async () => {
            const consumer = await StatedWorkflow.pulsarClient.subscribe({
                topic: type,
                subscription: type, //we will have only one shared-mode consumer group per message type/topics and we name it after the type of the message
                subscriptionType: 'Shared',
                subscriptionInitialPosition: initialPosition
            });
            // Store the consumer in the map
            StatedWorkflow.consumers.set(type, consumer);
            let data;
            let countdown = maxConsume;
            while (true) {
                try {
                    data = await consumer.receive();
                    let obj;
                    try {
                        const str = data.getData().toString();
                        obj = JSON.parse(str);
                    } catch (error) {
                        console.error("unable to parse data to json:", error);
                    }
                    WorkflowDispatcher.dispatchToAllSubscribers(type, obj);
                    if(countdown && --countdown===0){
                        break;
                    }
                } catch (error) {
                    console.error("Error receiving or dispatching message:", error);
                } finally {
                    if (data !== undefined) {
                        consumer.acknowledge(data);
                    }
                }
            }
            this.logger.debug(`closing consumer with params ${stated.stringify(subscriptionParams)}`);
            await consumer.close()
        })();
    }


    static async nextCloudEvent(subscriptionParams) {

        const {testData} = subscriptionParams;
        if (testData) {
            const dispatcher = WorkflowDispatcher.getDispatcher(subscriptionParams);
            dispatcher.addBatch(testData);
            await dispatcher.drainBatch(); // in test mode we wanna actually wait for all the test events to process
            return;
        }
        //in real-life we take messages off pulsar
        this.pulsarSubscribe(subscriptionParams);

    }

    static onHttp(subscriptionParams) {
        const dispatcher = new WorkflowDispatcher(
            subscriptionParams
        );

        StatedWorkflow.app.all('*', (req, res) => {
            // Push the request and response objects to the dispatch queue to be handled by callback
            dispatcher.addToQueue({req, res});
        });

        StatedWorkflow.app.listen(StatedWorkflow.port, () => {
            console.log(`Server started on http://localhost:${StatedWorkflow.port}`);
        });


    }

    static async serial(input, steps, options) {
        const {name: workflowName, log} = options;
        let {id} = options;

        if (log === undefined) {
            throw new Error('log is missing from options');
        }

        if (id === undefined) {
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
            stepLog.error = {message: error.message};
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
    constructor(subscribeParams) {
        const {to: workflowFunction, parallelism, type, subscriberId} = subscribeParams;
        this.workflowFunction = workflowFunction;
        this.parallelism = parallelism || 1;
        this.subscriberId = subscriberId;
        this.type = type;
        this.queue = [];
        this.active = 0;
        this.promises = [];
        this.batchMode = false;
        this.batchCount = 0; // Counter to keep track of items in the batch
    }

    _getKey() {
        return WorkflowDispatcher._generateKey(this.type, this.subscriberId);
    }

    static dispatchers = new Map();       // key is type, value is a Set of keys
    static dispatcherObjects = new Map(); // key is composite key, value is WorkflowDispatcher object

    static _generateKey(type, subscriberId) {
        return `${type}-${subscriberId}`;
    }

    static _addDispatcher(dispatcher) {
        if (!this.dispatchers.has(dispatcher.type)) {
            this.dispatchers.set(dispatcher.type, new Set());
        }
        const key = dispatcher._getKey();
        this.dispatchers.get(dispatcher.type).add(key);
        this.dispatcherObjects.set(key, dispatcher);
    }

    static getDispatcher(subscriptionParams) {
        const {type, subscriberId} = subscriptionParams;
        const key = this._generateKey(type, subscriberId);
        if (!this.dispatcherObjects.has(key)) {
            const newDispatcher = new WorkflowDispatcher(subscriptionParams);
            this._addDispatcher(newDispatcher);
        }
        return this.dispatcherObjects.get(key);
    }

    static dispatchToAllSubscribers(type, data) {
        const keysSet = this.dispatchers.get(type);
        if (keysSet) {
            for (let key of keysSet) {
                const dispatcher = this.dispatcherObjects.get(key);
                dispatcher.addToQueue(data); // You can pass the actual data you want to dispatch here
            }
        } else {
            console.log(`No subscribers found for type ${type}`);
        }
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

