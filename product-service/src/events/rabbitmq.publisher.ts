import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqp-connection-manager';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';

/**
 * Thin wrapper around `amqp-connection-manager` for publishing
 * messages to the platform topic exchange.
 *
 * Why this exists instead of Nest's `ClientsModule.register({
 * transport: Transport.RMQ, options: { exchange, ... } })`:
 *
 *   In `@nestjs/microservices@10`, the `ClientRMQ.dispatchEvent`
 *   method calls `channel.sendToQueue(this.queue, ...)`, NOT
 *   `channel.publish(this.exchange, routingKey, ...)`. The
 *   `exchange` option is silently ignored on the publish path — the
 *   message is sent to the AMQP default exchange with `this.queue`
 *   as the routing key, which routes to a queue with that exact
 *   name (or nowhere, if no such queue exists). The queue defaults
 *   to the literal string `'default'` (`RQM_DEFAULT_QUEUE`), which
 *   is why every published event ended up in a queue literally named
 *   `default` instead of the topic exchange.
 *
 *   We confirmed this end-to-end:
 *     - Producer log: "Published products.event.created ... to ecommerce.events"
 *     - Broker reality: routing_key='default', exchange=''
 *
 *   Rather than monkey-patch @nestjs/microservices, we publish
 *   directly with `amqp-connection-manager`, which:
 *     - Gives us a long-lived confirm channel with auto-reconnect
 *       (the same robustness Nest was trying to give us).
 *     - Actually publishes to the configured exchange with the
 *       configured routing key (no surprises).
 *     - Surfaces publish failures via the Promise that `publish`
 *       returns (the `.catch()` we already had in the service).
 *
 * The consumer side keeps using `connectMicroservice(rmqOptions)`
 * — that path is correct and well-tested. Only the producer was
 * broken.
 */
@Injectable()
export class RabbitMqPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqPublisher.name);
  private connection: amqp.AmqpConnectionManager | null = null;
  private channel: ChannelWrapper | null = null;
  private readonly url: string;
  private readonly exchange: string;
  private readonly exchangeType: 'topic' | 'direct' | 'fanout' | 'headers';

  constructor(config: ConfigService) {
    this.url = config.get<string>('RABBITMQ_URL') ?? 'amqp://guest:guest@rabbitmq:5672';
    this.exchange =
      config.get<string>('RABBITMQ_EXCHANGE') ?? 'ecommerce.events';
    // Topics are how the rest of the platform subscribes
    // (`products.event.created`, `.updated`, `.deleted`); we lock
    // the exchange type here rather than reading it from env, since
    // it must match what consumers bind against.
    this.exchangeType = 'topic';
  }

  async onModuleInit(): Promise<void> {
    this.connection = amqp.connect([this.url], { heartbeatIntervalInSeconds: 15 });
    this.connection.on('connect', () => {
      this.logger.log(`connected to RabbitMQ at ${this.url}`);
    });
    this.connection.on('disconnect', ({ err }) => {
      this.logger.warn(`disconnected from RabbitMQ: ${err?.message ?? 'unknown'}`);
    });

    this.channel = this.connection.createChannel({
      json: false,
      setup: async (ch: ConfirmChannel) => {
        await ch.assertExchange(this.exchange, this.exchangeType, {
          durable: true,
        });
        this.logger.log(
          `exchange asserted: name=${this.exchange} type=${this.exchangeType} durable=true`,
        );
      },
    });

    // Wait for the channel to be ready before declaring ready to
    // emit. If the broker is unreachable, this rejects and the
    // container restart loop catches it loudly — same contract as
    // the broken Nest ClientProxy we replaced.
    await this.channel.waitForConnect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  /**
   * Publish a JSON-serializable payload to the topic exchange.
   *
   * Routing key is the caller-supplied `routingKey` (e.g.
   * `products.event.created`). The broker matches it against the
   * bindings on consumer queues; a routing key of `products.event.*`
   * in a binding will receive this message.
   *
   * IMPORTANT: Nest's `ServerRMQ` dispatches handlers by reading a
   * `pattern` field from the JSON body, NOT from the AMQP routing
   * key. So we embed the routing key into the body under `pattern`.
   * The rest of the original envelope (`event`, `occurredAt`, `data`)
   * is preserved as-is, so the inventory-service consumer keeps
   * reading `payload.data.id` exactly as before. The `pattern` key
   * is simply the same string duplicated inside the body for
   * dispatch purposes.
   *
   * Returns the underlying `ChannelWrapper.publish` promise so
   * callers can `await` and surface publish failures. Messages are
   * marked `persistent: true` so they survive a broker restart.
   */
  publish(routingKey: string, payload: unknown): Promise<boolean> {
    if (!this.channel) {
      // Should not happen — onModuleInit awaits waitForConnect.
      // Defensive throw so a misuse is loud rather than silent.
      throw new Error('RabbitMqPublisher used before onModuleInit completed');
    }
    const envelope = { pattern: routingKey, data: payload };
    const body = Buffer.from(JSON.stringify(envelope));
    return this.channel.publish(this.exchange, routingKey, body, {
      persistent: true,
      contentType: 'application/json',
      messageId: cryptoRandomId(),
      timestamp: Math.floor(Date.now() / 1000),
    });
  }
}

/**
 * Tiny inline replacement for `crypto.randomUUID()` so the publisher
 * doesn't have to depend on the `crypto` module being polyfilled
 * everywhere. 16 hex chars is more than enough for log correlation.
 */
function cryptoRandomId(): string {
  return Math.random().toString(16).slice(2, 18).padEnd(16, '0');
}