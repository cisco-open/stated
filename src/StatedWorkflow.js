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

//This class is a wrapper around the TemplateProcessor class that provides workflow functionality
class StatedWorkflow {

    static async newWorkflow(template) {
        this.context = {
            "serial": StatedWorkflow.serial.bind(this),
            "parallel": StatedWorkflow.parallel.bind(this),
            "nextCloudEvent": StatedWorkflow.nextCloudEvent.bind(this),
            "logFunctionInvocation": StatedWorkflow.logFunctionInvocation.bind(this)
        };
        const templateProcessor = new TemplateProcessor(template, this.context);
        templateProcessor.logLevel = "debug";
        await templateProcessor.initialize();
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

    static async nextCloudEvent(subscriptionParams, log) {
        if (subscriptionParams.data ) {
            for (const eventData of subscriptionParams.data) {
                // const filtered = this.templateProcessor.execute(subscriptionParams['filter$'], {$e: eventData});
                // if (filtered) {
                //     await toFunc.apply(this, [eventData]);
                // }
                try {
                    // The below function is needed to make a useful call
                    // const toFunction = this.templateProcessor.getFunction(subscriptionParams.to);
                    const result = await subscriptionParams.to.apply(this, [eventData]);
                    await StatedWorkflow.logFunctionInvocation(to, [eventData], result, null, log);
                } catch (error) {
                    await StatedWorkflow.logFunctionInvocation(to, [currentInput], result, error, log);
                }

            }
        }
    }

    //This function is called by the template processor to execute an array of stages in serial
    static async serial(initialInput, stages, log) {
        let results = [];
        let currentInput = initialInput;
        for (let stage of stages) {
            if (stage.output.results.length > 0 || stage.output.errors.length > 0) {
                //if we have already run this stage, skip it
                console.log("Skipping stage " + stage.name)
                continue;
            }
            try {
                const result = await stage.function.apply(this, [currentInput]);
                await StatedWorkflow.logFunctionInvocation(stage, [currentInput], result, null, log);
            } catch (error) {
                await StatedWorkflow.logFunctionInvocation(stage, [currentInput], result, error, log);
            }
            stage.output.results.push(result);
            currentInput = result;
            results.push(result);
        }
        return results;
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
}

module.exports = StatedWorkflow;

