import pulsar from 'pulsar-flex';
import {jest, describe, beforeAll, afterAll, test, expect} from "@jest/globals";

describe('pulsar-flex Integration Test', () => {
    //jest.useFakeTimers()
    let producer;
    let consumer;

    const topic = "persistent://public/default/yyy";
    const subscription = "test-subscription-xxx";

    const messagesToSend = [
        { properties: { pulsar: "flex" }, payload: 'Ayeo' }
    ];

    let receivedMessages = [];

    // Increase Jest's default timeout since Pulsar operations might take longer
    jest.setTimeout(1000000000); // 20 seconds

    beforeAll(async () => {
        // Initialize Producer
        producer = new pulsar.Producer({
            topic: topic,
            discoveryServers: ['localhost:6650'],
            // If your Pulsar setup requires JWT, ensure it's set in the environment variables
            jwt: process.env.JWT_TOKEN,
            producerAccessMode: pulsar.Producer.ACCESS_MODES.SHARED,
            logLevel: pulsar.logLevel.TRACE
            // Optionally, provide a logCreator function for custom logging
        });

        // Initialize Consumer
        consumer = new pulsar.Consumer({
            topic: topic,
            subscription: subscription,
            discoveryServers: ['localhost:6650'],
            jwt: process.env.JWT_TOKEN,
            subType: pulsar.Consumer.SUB_TYPES.EXCLUSIVE,
            consumerName: 'Test Consumer xxx',
            receiveQueueSize: 1,
            logLevel: pulsar.logLevel.TRACE,
            // Optionally, provide a logCreator function for custom logging
        });

        // Create Producer
        await producer.create();


        // Optional: Listen to Consumer state changes
        consumer.onStateChange(({ previousState, newState }) => {
            //console.log(`Consumer state changed from ${previousState} to ${newState}.`);
        });

        // Subscribe Consumer
        await consumer.subscribe();

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

    test('should produce and consume messages successfully', async () => {
        // Send a batch of messages
        await producer.sendMessage({ properties: { pulsar: "flex" }, payload: 'Ayeo' });
        await producer.close();
        // Wait for messages to be received
        const maxWaitTime = 10000; // 10 seconds
        const pollInterval = 100; // 100ms
        let waited = 0;

        while (receivedMessages.length < 1 && waited < maxWaitTime) {
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

        try {
            await consumer.unsubscribe();
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
        /** uncomment these lines, and you will find that the test completes normally with no open handles
         * detected.
         */
        producer._client.getCnx().close();
        await new Promise(resolve => setTimeout(resolve, 11000));
    });
});
