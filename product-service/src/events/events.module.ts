import { Module } from '@nestjs/common';

import { RabbitMqPublisher } from './rabbitmq.publisher';

/**
 * Owns the publisher used to emit product lifecycle events to the
 * platform RabbitMQ topic exchange.
 *
 * The publisher is a global singleton — every service that wants to
 * emit should inject `RabbitMqPublisher` rather than opening their
 * own AMQP connection. That keeps the connection count down and
 * ensures a single set of reconnect/heartbeat settings.
 *
 * See `rabbitmq.publisher.ts` for the long-form rationale on why
 * this exists outside of Nest's `ClientsModule.register`.
 */
@Module({
  providers: [RabbitMqPublisher],
  exports: [RabbitMqPublisher],
})
export class EventsModule {}