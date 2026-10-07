import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import amqp, { type ConsumeMessage } from 'amqplib';

export const TEST_RABBITMQ_URL = process.env.TEST_RABBITMQ_URL ?? 'amqp://nile:nile@localhost:5672';

/**
 * Binds a temporary, exclusive queue to `exchange` and collects every message routed to it.
 * Use it to observe what a publisher actually delivered to the broker.
 */
export async function captureMessages(exchange: string, bindingKey = '#') {
  const connection = await amqp.connect(TEST_RABBITMQ_URL);
  // Tests may force-close broker connections; an unhandled "error" event would crash the run.
  connection.on('error', () => {});
  const channel = await connection.createChannel();
  await channel.assertExchange(exchange, 'topic', { durable: true });
  const { queue } = await channel.assertQueue('', { exclusive: true, autoDelete: true });
  await channel.bindQueue(queue, exchange, bindingKey);

  const messages: ConsumeMessage[] = [];
  await channel.consume(
    queue,
    (message) => {
      if (message) messages.push(message);
    },
    { noAck: true },
  );

  return {
    messages,
    /** Resolves once at least `count` messages arrived (or rejects after `timeoutMs`). */
    async waitFor(count: number, timeoutMs = 5_000): Promise<ConsumeMessage[]> {
      const deadline = Date.now() + timeoutMs;
      while (messages.length < count) {
        if (Date.now() > deadline) {
          throw new Error(`Expected ${count} messages, received ${messages.length}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return messages;
    },
    async close(): Promise<void> {
      await connection.close().catch(() => {}); // may already be closed by the broker
    },
  };
}

/** Makes the broker forcibly close every client connection (a server-side connection loss). */
export async function closeAllBrokerConnections(): Promise<void> {
  await promisify(execFile)('docker', [
    'compose',
    'exec',
    '-T',
    'rabbitmq',
    'rabbitmqctl',
    'close_all_connections',
    'integration test',
  ]);
}
