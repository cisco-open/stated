import pulsar from 'pulsar-flex';
import {jest, describe, beforeAll, afterAll, test, expect} from "@jest/globals";

describe('pulsar-flex Integration Test', () => {
    let producer;
    let consumer;

    const topic = "persistent://public/default/xxx";
    const subscription = "test-subscription";

    const messagesToSend = [
        { properties: { pulsar: "flex" }, payload: 'Ayeo' },
        { properties: { pulsar: "flex" }, payload: 'Ayeo' }
    ];

    let receivedMessages = [];

    // Increase Jest's default timeout since Pulsar operations might take longer
    jest.setTimeout(20000); // 20 seconds

    beforeAll(async () => {
        // Initialize Producer
        producer = new pulsar.Producer({
            topic: topic,
            discoveryServers: ['localhost:6650'],
            // If your Pulsar setup requires JWT, ensure it's set in the environment variables
            jwt: process.env.JWT_TOKEN,
            producerAccessMode: pulsar.Producer.ACCESS_MODES.SHARED,
            logLevel: pulsar.logLevel.INFO
            // Optionally, provide a logCreator function for custom logging
        });

        // Initialize Consumer
        consumer = new pulsar.Consumer({
            topic: topic,
            subscription: subscription,
            discoveryServers: ['localhost:6650'],
            jwt: process.env.JWT_TOKEN,
            subType: pulsar.Consumer.SUB_TYPES.EXCLUSIVE,
            consumerName: 'Test Consumer',
            receiveQueueSize: 1000,
            logLevel: pulsar.logLevel.INFO,
            // Optionally, provide a logCreator function for custom logging
        });

        // Create Producer
        await producer.create();

        // Subscribe Consumer
        await consumer.subscribe();

        // Optional: Listen to Consumer state changes
        consumer.onStateChange(({ previousState, newState }) => {
            console.log(`Consumer state changed from ${previousState} to ${newState}.`);
        });

        // Run Consumer
        await consumer.run({
            onMessage: async ({ ack, message, properties, redeliveryCount }) => {
                await ack(); // Acknowledge the message
                receivedMessages.push({
                    message: message, // Contains the payload
                    properties: properties, // Message properties
                    redeliveryCount: redeliveryCount, // Number of times the message was redelivered
                });
            },
            autoAck: false, // Manual acknowledgment
        });
    });

    afterAll(async () => {
        // Close Producer and Consumer
        await producer.close();
        await consumer.unsubscribe();
    });

    test('should produce and consume messages successfully', async () => {
        // Send a batch of messages
        await producer.sendBatch({ messages: messagesToSend });

        // Wait for messages to be received
        const maxWaitTime = 10000; // 10 seconds
        const pollInterval = 100; // 100ms
        let waited = 0;

        while (receivedMessages.length < messagesToSend.length && waited < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            waited += pollInterval;
        }

        // Assertions
        expect(receivedMessages.length).toBe(messagesToSend.length);

        receivedMessages.forEach((received, index) => {
            expect(received.message.toString()).toBe(messagesToSend[index].payload);
            expect(received.properties).toEqual(messagesToSend[index].properties);
            expect(received.redeliveryCount).toBe(0); // Assuming no redeliveries
        });
    });
});
