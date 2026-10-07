import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import type { MessagePublisher, OutgoingMessage } from './message-publisher.js';

export interface RabbitMqPublisherOptions {
  url: string;
  /** Durable topic exchange to publish to; declared on connect. */
  exchange: string;
  /** Shown in the RabbitMQ management UI, e.g. "nile-worker". */
  connectionName: string;
  connectTimeoutMs?: number;
  /** Connection/channel errors (logging hook; this package cannot depend on the app logger). */
  onError?: (err: Error) => void;
}

interface Session {
  connection: ChannelModel;
  channel: ConfirmChannel;
}

/**
 * Publishes persistent messages to a topic exchange using publisher confirms, so publish()
 * resolves only after the broker has accepted the message.
 *
 * Connects lazily. When the connection or channel is lost, the session is dropped and the next
 * publish reconnects; callers (the outbox relay) retry failed publishes.
 */
export class RabbitMqPublisher implements MessagePublisher {
  private session: Promise<Session> | undefined;
  private closed = false;

  constructor(private readonly options: RabbitMqPublisherOptions) {}

  async publish(message: OutgoingMessage): Promise<void> {
    const { channel } = await this.getSession();
    const content = Buffer.from(JSON.stringify(message.body), 'utf8');

    await new Promise<void>((resolve, reject) => {
      // The confirm callback fires even when the write buffer is full (publish returns false),
      // so awaiting it also bounds how far ahead of the broker the caller can get.
      channel.publish(
        this.options.exchange,
        message.routingKey,
        content,
        {
          persistent: true,
          contentType: 'application/json',
          contentEncoding: 'utf-8',
          messageId: message.id,
          type: message.type,
          correlationId: message.correlationId,
          timestamp: Math.floor(message.timestamp.getTime() / 1000),
          headers: message.headers,
        },
        (err: unknown) =>
          err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(),
      );
    });
  }

  async ping(): Promise<void> {
    await this.getSession();
  }

  async close(): Promise<void> {
    this.closed = true;
    const session = this.session;
    this.session = undefined;
    if (!session) return;

    try {
      const { connection } = await session;
      await connection.close();
    } catch {
      // Never connected, or the connection is already gone.
    }
  }

  private getSession(): Promise<Session> {
    if (this.closed) return Promise.reject(new Error('Publisher is closed'));

    if (!this.session) {
      // Only clear the session this connection belongs to: a late "close" from an old
      // connection must not discard a newer one.
      const drop = () => {
        if (this.session === pending) this.session = undefined;
      };
      const pending: Promise<Session> = this.connect(drop).catch((err: unknown) => {
        drop();
        throw err;
      });
      this.session = pending;
    }
    return this.session;
  }

  private async connect(drop: () => void): Promise<Session> {
    const { url, exchange, connectionName, connectTimeoutMs = 5_000 } = this.options;

    const connection = await amqp.connect(url, {
      timeout: connectTimeoutMs,
      clientProperties: { connection_name: connectionName },
    });

    // "close" always follows "error" and carries the error when the connection was lost (including
    // a broker-forced close, which emits no "error"), so report it once, there. The empty "error"
    // listener only prevents an unhandled "error" event from crashing the process.
    connection.on('error', () => {});
    connection.on('close', (err?: Error) => {
      if (err) this.options.onError?.(err);
      drop();
    });

    try {
      const channel = await connection.createConfirmChannel();
      channel.on('error', (err: Error) => this.options.onError?.(err));
      channel.on('close', drop);
      await channel.assertExchange(exchange, 'topic', { durable: true });
      return { connection, channel };
    } catch (err) {
      await connection.close().catch(() => {});
      throw err;
    }
  }
}
