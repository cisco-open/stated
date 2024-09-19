// pulsar.test.js
import Pulsar from 'pulsar-client';

describe('Pulsar Standalone Mode', () => {
    let client;
    let producer;
    let consumer;

    beforeAll(async () => {
        // Create a Pulsar client connected to the local standalone broker
        client = new Pulsar.Client({
            serviceUrl: 'pulsar://localhost:6650',
        });

        // Create a producer on a test topic
        producer = await client.createProducer({
            topic: 'persistent://public/default/test-topic',
        });

        // Create a consumer to verify message delivery
        consumer = await client.subscribe({
            topic: 'persistent://public/default/test-topic',
            subscription: 'test-subscription',
            subscriptionType: 'Exclusive',
        });
    });

    afterAll(async () => {
        // Clean up: close the producer, consumer, and client
        await producer.close();
        await consumer.close();
        await client.close();
    });

    test('should produce and consume a message', async () => {
        // Send a test message
        const message = Buffer.from('Hello, Pulsar!');
        await producer.send({ data: message });

        // Receive the message
        const msg = await consumer.receive();
        expect(msg.getData().toString()).toBe('Hello, Pulsar!');

        // Acknowledge the message
        consumer.acknowledge(msg);
    });
});
