import type { Redis } from 'ioredis';
import type { MessagePublisher } from '../../pkg/messaging/message-publisher.js';
import type { Database } from '../database/database.js';
import type { HealthCheck } from './health-check.js';

export function postgresHealthCheck(db: Database): HealthCheck {
  return {
    name: 'postgres',
    async check() {
      await db.query('SELECT 1');
    },
  };
}

export function rabbitmqHealthCheck(publisher: MessagePublisher): HealthCheck {
  return {
    name: 'rabbitmq',
    check: () => publisher.ping(),
  };
}

export function redisHealthCheck(redis: Redis): HealthCheck {
  return {
    name: 'redis',
    async check() {
      const reply = await redis.ping();
      if (reply !== 'PONG') throw new Error(`Unexpected PING reply: ${reply}`);
    },
  };
}
