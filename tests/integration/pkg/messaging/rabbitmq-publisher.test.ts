import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { OutgoingMessage } from '../../../../src/pkg/messaging/message-publisher.js';
import { RabbitMqPublisher } from '../../../../src/pkg/messaging/rabbitmq-publisher.js';
import {
  captureMessages,
  closeAllBrokerConnections,
  TEST_RABBITMQ_URL,
} from '../../support/rabbitmq.js';

const EXCHANGE = 'nile.events.test';

function message(overrides: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    id: randomUUID(),
    routingKey: 'seller.approved',
    type: 'seller.approved',
    body: { hello: 'world' },
    timestamp: new Date('2026-10-07T12:00:00.000Z'),
    correlationId: 'corr-mq-1',
    headers: { 'x-aggregate-type': 'seller' },
    ...overrides,
  };
}

describe('RabbitMqPublisher', () => {
  const cleanups: (() => Promise<void>)[] = [];

  function publisher(url = TEST_RABBITMQ_URL, errors: Error[] = []) {
    const instance = new RabbitMqPublisher({
      url,
      exchange: EXCHANGE,
      connectionName: 'nile-test',
      connectTimeoutMs: 2_000,
      onError: (err) => errors.push(err),
    });
    cleanups.push(() => instance.close());
    return instance;
  }

  async function capture() {
    const consumer = await captureMessages(EXCHANGE);
    cleanups.push(() => consumer.close());
    return consumer;
  }

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('publishes a persistent JSON message with its metadata', async () => {
    const consumer = await capture();
    const sent = message();

    await publisher().publish(sent);

    const [received] = await consumer.waitFor(1);
    expect(JSON.parse(received?.content.toString() ?? '')).toEqual({ hello: 'world' });
    expect(received?.fields.routingKey).toBe('seller.approved');
    expect(received?.properties).toMatchObject({
      messageId: sent.id,
      type: 'seller.approved',
      correlationId: 'corr-mq-1',
      contentType: 'application/json',
      deliveryMode: 2, // persistent
      timestamp: Math.floor(sent.timestamp.getTime() / 1000),
      headers: expect.objectContaining({ 'x-aggregate-type': 'seller' }),
    });
  });

  it('routes by routing key on the topic exchange', async () => {
    const sellerEvents = await captureMessages(EXCHANGE, 'seller.*');
    cleanups.push(() => sellerEvents.close());
    const instance = publisher();

    await instance.publish(message({ routingKey: 'order.created', type: 'order.created' }));
    await instance.publish(message());

    await sellerEvents.waitFor(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sellerEvents.messages.map((m) => m.fields.routingKey)).toEqual(['seller.approved']);
  });

  it('reuses one connection for many publishes', async () => {
    const consumer = await capture();
    const instance = publisher();

    await Promise.all(Array.from({ length: 50 }, () => instance.publish(message())));

    expect(await consumer.waitFor(50)).toHaveLength(50);
  });

  it('reconnects after the broker closes the connection', async () => {
    const consumer = await capture();
    const errors: Error[] = [];
    const instance = publisher(TEST_RABBITMQ_URL, errors);
    await instance.publish(message());

    await closeAllBrokerConnections();
    // The test consumer's connection was closed too; open a new one.
    const after = await capture();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await instance.publish(message({ id: 'after-reconnect' }));

    await after.waitFor(1);
    expect(after.messages[0]?.properties.messageId).toBe('after-reconnect');
    expect(consumer.messages).toHaveLength(1);
    // The server-side close was reported through onError rather than crashing the process.
    expect(errors.length).toBeGreaterThan(0);
  }, 20_000);

  it('rejects promptly when the broker is unreachable', async () => {
    const unreachable = publisher('amqp://nile:nile@127.0.0.1:1');
    const started = Date.now();

    await expect(unreachable.publish(message())).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('ping() succeeds when connected and fails when unreachable', async () => {
    await expect(publisher().ping()).resolves.toBeUndefined();
    await expect(publisher('amqp://nile:nile@127.0.0.1:1').ping()).rejects.toThrow();
  });

  it('rejects publishes after close() and tolerates repeated close()', async () => {
    const instance = publisher();
    await instance.publish(message());

    await instance.close();
    await instance.close();

    await expect(instance.publish(message())).rejects.toThrow('Publisher is closed');
  });

  it('closes cleanly without ever connecting', async () => {
    await expect(publisher().close()).resolves.toBeUndefined();
  });
});
