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
import TemplateProcessor from "../../dist/src/TemplateProcessor.js";
import StatedREPL from "../../dist/src/StatedREPL.js";
import express from 'express';
import Pulsar from 'pulsar-client';
import {Kafka, logLevel} from 'kafkajs';
import winston from "winston";
import {WorkflowDispatcher} from "./WorkflowDispatcher.js";

//This class is a wrapper around the TemplateProcessor class that provides workflow functionality
export class StatedWorkflow {
    // static express = require('express');
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
        level: "debug",
    });

    static newWorkflow(template) {
        this.context = {
            "id": StatedWorkflow.generateDateAndTimeBasedID.bind(this),
            "serial": StatedWorkflow.serial.bind(this),
            "parallel": StatedWorkflow.parallel.bind(this),
            "nextCloudEvent": StatedWorkflow.nextCloudEvent.bind(this),
            "onHttp": StatedWorkflow.onHttp.bind(this),
            "subscribe": StatedWorkflow.subscribe.bind(this),
            "publish": StatedWorkflow.publish.bind(this),
            "logFunctionInvocation": StatedWorkflow.logFunctionInvocation.bind(this)
        };
        const templateProcessor = new TemplateProcessor(template, this.context);
        templateProcessor.logLevel = logLevel.DEBUG;
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
        console.log(StatedREPL.stringify(logMessage));

        // Assuming 'logs' array is inside 'log' object
        if (log.logs) {
            log.logs.push(logMessage);
        } else {
            log.logs = [logMessage];
        }
    }

    static async subscribe(subscribeOptions, clientParams) {
        const {source} = subscribeOptions;
        StatedWorkflow.logger.debug(`subscribing ${StatedREPL.stringify(source)}`);
        if (source === 'http') {
            return StatedWorkflow.onHttp(subscribeOptions);
        }
        if (source === 'cloudEvent' || source === 'data') {
            return StatedWorkflow.nextCloudEvent(subscribeOptions, clientParams);
        }
        if (!source) {
            throw new Error("Subscribe source not set");
        }
        throw new Error(`Unknown subscribe source ${source}`);
    }

    static ensureClient(params) {
        if (!params || params.type == 'pulsar') {
            StatedWorkflow.createPulsarClient(params);
        } else if (params.type == 'kafka') {
            StatedWorkflow.createKafkaClient(params);
        }
    }

    static pulsarClient = new Pulsar.Client({
        serviceUrl: 'pulsar://localhost:6650',
    });

    static kafkaClient = new Kafka({
        clientId: 'my-app',  // Optional: you can specify a client ID
        brokers: ['kafka:9092'],  // Replace with the address of your Kafka broker(s)
    });

    static consumers = new Map(); //key is type, value is pulsar consumer
    static dispatchers = new Map(); //key is type, value Set of WorkflowDispatcher

    static createPulsarClient(params) {
        if (StatedWorkflow.pulsarClient) return;
    
        StatedWorkflow.pulsarClient = new Pulsar.Client({
            serviceUrl: 'pulsar://localhost:6650',
        });
    }
    static createKafkaClient(params) {
        if (StatedWorkflow.kafkaClient) return;
    
        StatedWorkflow.kafkaClient = new Kafka({
            clientId: 'my-app',
            brokers: ['localhost:9092'],
            logLevel: logLevel.DEBUG,
        });
    }

    static publish(params, clientParams) {
        StatedWorkflow.logger.debug(`publish params ${StatedREPL.stringify(params)} with clientParams ${StatedREPL.stringify(clientParams)}`);
        const {type, data} = params;
        if (clientParams.type === 'kafka') {
            StatedWorkflow.publishKafka(params, clientParams);
        } else {
            StatedWorkflow.publishPulsar(params, clientParams);
        }
    }

    static publishKafka(params, clientParams) {
        StatedWorkflow.logger.debug(`kafka publish params ${StatedREPL.stringify(params)}`);
        const {type, data} = params;

        (async () => {
            const producer = StatedWorkflow.kafkaClient.producer();

            await producer.connect();

            try {
                let _data = data;
                if (data._jsonata_lambda === true) {
                    _data = await data.apply(this, []); //data is a function, call it
                }
                StatedWorkflow.logger.debug(`kafka producer sending ${StatedREPL.stringify(_data)} to ${type}`);

                // Send a message
                await producer.send({
                    topic: type,
                    messages: [
                        { value: StatedREPL.stringify(_data, null, 2) },
                    ],
                });
            } catch (err) {
                console.error(`Error publishing to Kafka: ${err}`);
            } finally {
                // Close the producer when done
                await producer.disconnect();
            }
        })();
    }

    static publishPulsar(params, clientParams) {
        StatedWorkflow.logger.debug(`pulsar publish params ${StatedREPL.stringify(params)}`);
        const {type, data} = params;
        (async () => {


            // Create a producer
            const producer = await StatedWorkflow.pulsarClient.createProducer({
                topic: type,
            });

            try {
                let _data = data;
                if (data._jsonata_lambda === true) {
                    _data = await data.apply(this, []); //data is a function, call it
                }
                StatedWorkflow.logger.debug(`pulsar producer sending ${StatedREPL.stringify(_data)}`);
                // Send a message
                const messageId = await producer.send({
                    data: Buffer.from(StatedREPL.stringify(_data, null, 2)),
                });
            }finally {
                // Close the producer and client when done
                producer.close();
            }
        })();

    }

    static subscribePulsar(subscriptionParams) {
        const {type, initialPosition = 'earliest', maxConsume = -1} = subscriptionParams;
        StatedWorkflow.logger.debug(`pulsar subscribe params ${StatedREPL.stringify(subscriptionParams)}`);
        let consumer, dispatcher;
        //make sure a dispatcher exists for the combination of type and subscriberId
        WorkflowDispatcher.getDispatcher(subscriptionParams);
        // Check if a consumer already exists for the given subscription
        if (StatedWorkflow.consumers.has(type)) {
            StatedWorkflow.logger.debug(`pulsar subscriber already started. Bail.`);
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
            StatedWorkflow.logger.debug(`closing consumer with params ${StatedREPL.stringify(subscriptionParams)}`);
            await consumer.close()
        })();
    }

    static async subscribeKafka(subscriptionParams) {
        const { type, initialOffset = 'earliest', maxConsume = -1 } = subscriptionParams;
        StatedWorkflow.logger.debug(`Kafka subscribe params ${StatedREPL.stringify(subscriptionParams)}`);

        // Make sure a dispatcher exists for the combination of type and subscriberId
        WorkflowDispatcher.getDispatcher(subscriptionParams);
    
        // Check if a consumer already exists for the given subscription
        if (StatedWorkflow.consumers.has(type)) {
            StatedWorkflow.logger.debug(`Kafka subscriber already started. Bail.`);
            return; // Bail, we are already consuming and dispatching this type
        }
    
        const consumer = StatedWorkflow.kafkaClient.consumer({ groupId: type });
    
        try {
            await consumer.connect();
            await consumer.subscribe({ topic: type, fromBeginning: true });
  
        } catch (e) {
            StatedWorkflow.logger.debug(`Kafka subscriber - failed, e: ${e}`);
        }
        StatedWorkflow.logger.debug(`Kafka subscriber - subscribed.`);
    
        // Store the consumer in the map
        StatedWorkflow.consumers.set(type, consumer);
        let countdown = maxConsume;
    
        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                let data;
                StatedWorkflow.logger.debug(`Kafka subscriber got ${message} from ${topic}:${partition}.`);
                try {
                    const str = message.value.toString();
                    data = JSON.parse(str);
                } catch (error) {
                    console.error("Unable to parse data to JSON:", error);
                }
    
                WorkflowDispatcher.dispatchToAllSubscribers(type, data);
    
                if (countdown && --countdown === 0) {
                    // Disconnect the consumer if maxConsume messages have been processed
                    await consumer.disconnect();
                }
            }
        });
    }

    static async nextCloudEvent(subscriptionParams, clientParams) {

        const {testData} = subscriptionParams;
        if (testData) {
            const dispatcher = WorkflowDispatcher.getDispatcher(subscriptionParams);
            dispatcher.addBatch(testData);
            await dispatcher.drainBatch(); // in test mode we wanna actually wait for all the test events to process
            return;
        }
        //in real-life we take messages off a message bus
        if (clientParams.type === 'kafka') {
            StatedWorkflow.createKafkaClient(clientParams);
            StatedWorkflow.subscribeKafka(subscriptionParams, clientParams);
        } else {
            StatedWorkflow.createPulsarClient(clientParams);
            StatedWorkflow.subscribePulsar(subscriptionParams, clientParams);
        }
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


export const generateDateAndTimeBasedID = StatedWorkflow.generateDateAndTimeBasedID;
export const serial = StatedWorkflow.serial;
export const parallel = StatedWorkflow.parallel;
export const nextCloudEvent = StatedWorkflow.nextCloudEvent;
export const onHttp = StatedWorkflow.onHttp;
export const subscribe = StatedWorkflow.subscribe;
export const publish = StatedWorkflow.publish;
export const logFunctionInvocation = StatedWorkflow.logFunctionInvocation;