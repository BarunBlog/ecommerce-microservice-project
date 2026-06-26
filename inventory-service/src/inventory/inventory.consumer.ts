import { Controller, Logger } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { Channel, Message } from 'amqplib';

import { InventoryService } from './inventory.service';
import {
  ProductCreatedEvent,
  ProductDeletedEvent,
  ProductUpdatedEvent,
} from './entities/inventory.entity';

/**
 * RabbitMQ consumer for the `products.event.*` lifecycle stream.
 *
 * Why this lives in its own file:
 *   - inventory.controller.ts is HTTP-only — it serves the REST API
 *     under /api/inventory. Mixing @EventPattern handlers into it
 *     conflates two transports and makes the file harder to read.
 *   - All async event-handling concerns (ack/nack, payload
 *     validation, structured logging) live here. New event types can
 *     be added by registering another @EventPattern method below.
 *
 * Wiring:
 *   - This class is registered as a `controller` in InventoryModule,
 *     so it is instantiated by Nest and its @EventPattern methods
 *     are bound to the RMQ transport set up in main.ts via
 *     `app.connectMicroservice(...)`.
 *   - The transport binds to the `ecommerce.events` topic exchange
 *     with the routing key pattern `products.event.*` (a single
 *     wildcard binding is the cleanest way to subscribe to all three
 *     lifecycle events without redeclaring the consumer). The
 *     event-specific @EventPattern decorators below dispatch to the
 *     matching handler method based on the message's routing key.
 *
 * Ack semantics (consistent across all three handlers):
 *   - noAck: false on the transport, so we manually ack/nack.
 *   - Successful processing → channel.ack(message).
 *   - Recoverable failure (DB outage) → channel.nack(message, false,
 *     requeue=true) so the broker can retry. We log loudly.
 *   - Non-recoverable failure (invalid UUID, malformed payload) →
 *     channel.nack(message, false, requeue=false) so the message
 *     drops. A requeue here would block the queue forever on a
 *     poison message.
 */
@Controller()
export class InventoryConsumer {
  private readonly logger = new Logger(InventoryConsumer.name);

  constructor(private readonly inventory: InventoryService) {
    this.logger.log(
      'InventoryConsumer registered — listening to products.event.{created,updated,deleted}',
    );
  }

  // ---------------------------------------------------------- products.event.created

  /**
   * Consume `products.event.created` from the platform topic exchange.
   * Idempotently provisions an Inventory row with stockCount=0 for
   * the new product.
   */
  @EventPattern('products.event.created')
  async onProductCreated(
    @Payload() payload: ProductCreatedEvent,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as Channel;
    const message = context.getMessage() as Message;
    this.logReceived('products.event.created', payload, message);

    try {
      const row = await this.inventory.handleProductCreated(payload);
      if (row) {
        this.logger.log(
          `[products.event.created] provisioned inventory id=${row.id} productId=${row.productId} stockCount=${row.stockCount}`,
        );
      }
      channel.ack(message);
    } catch (err) {
      this.handleFailure(
        'products.event.created',
        payload,
        message,
        channel,
        err as Error,
      );
    }
  }

  // ---------------------------------------------------------- products.event.updated

  /**
   * Consume `products.event.updated`. The product row already exists
   * (and so does our Inventory row, since created runs first), so
   * the handler is a no-op verification pass — we just log that we
   * observed the update. A future feature (e.g. a sync of `location`
   * or a default `reservedCount` from product metadata) can hook in
   * here without changing the consumer contract.
   */
  @EventPattern('products.event.updated')
  async onProductUpdated(
    @Payload() payload: ProductUpdatedEvent,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as Channel;
    const message = context.getMessage() as Message;
    this.logReceived('products.event.updated', payload, message);

    try {
      const productId = await this.inventory.handleProductUpdated(payload);
      if (productId) {
        this.logger.log(
          `[products.event.updated] observed update for productId=${productId} (no inventory change)`,
        );
      }
      channel.ack(message);
    } catch (err) {
      this.handleFailure(
        'products.event.updated',
        payload,
        message,
        channel,
        err as Error,
      );
    }
  }

  // ---------------------------------------------------------- products.event.deleted

  /**
   * Consume `products.event.deleted`. Two cases:
   *   - Soft delete (payload.data.hard === false): we leave the
   *     Inventory row alone. Soft-deleted products still occupy a
   *     stock slot until hard-deleted; clearing inventory here would
   *     lose the audit trail of stock the product ever carried.
   *   - Hard delete (payload.data.hard === true): we delete the
   *     matching Inventory row. The product row no longer exists in
   *     product-service, so a dangling Inventory row would be
   *     unreachable from any UI and is just dead weight.
   */
  @EventPattern('products.event.deleted')
  async onProductDeleted(
    @Payload() payload: ProductDeletedEvent,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as Channel;
    const message = context.getMessage() as Message;
    this.logReceived('products.event.deleted', payload, message);

    try {
      const result = await this.inventory.handleProductDeleted(payload);
      if (result === 'deleted') {
        this.logger.log(
          `[products.event.deleted] hard-deleted inventory row for productId=${payload.data.id}`,
        );
      } else if (result === 'kept') {
        this.logger.log(
          `[products.event.deleted] soft-delete observed for productId=${payload.data.id} — inventory row retained`,
        );
      } else if (result === 'absent') {
        this.logger.log(
          `[products.event.deleted] no inventory row existed for productId=${payload.data.id} (never provisioned)`,
        );
      }
      channel.ack(message);
    } catch (err) {
      this.handleFailure(
        'products.event.deleted',
        payload,
        message,
        channel,
        err as Error,
      );
    }
  }

  // ---------------------------------------------------------- helpers

  /**
   * One place for "we got a message" logging so every handler logs
   * the same fields. Includes the routing key, the data.id we care
   * about, and a couple of broker-level fields useful when debugging
   * redelivery or queue depth.
   */
  private logReceived(
    routingKey: string,
    payload: unknown,
    message: Message,
  ): void {
    const dataId =
      payload && typeof payload === 'object'
        ? (payload as { data?: { id?: unknown } }).data?.id
        : undefined;
    this.logger.log(
      `[${routingKey}] received (messageId=${this.shortMessageId(message)}, dataId=${typeof dataId === 'string' ? dataId : '<missing>'}, deliveryTag=${message.fields.deliveryTag}, redelivered=${message.fields.redelivered})`,
    );
  }

  /**
   * Centralised failure path. Decides between requeue (transient) and
   * drop (poison message) based on whether the inventory service
   * flagged the error as non-recoverable.
   */
  private handleFailure(
    routingKey: string,
    payload: unknown,
    message: Message,
    channel: Channel,
    err: Error,
  ): void {
    const dataId =
      payload && typeof payload === 'object'
        ? (payload as { data?: { id?: unknown } }).data?.id
        : undefined;

    // Validation-style failures are surfaced via a sentinel property
    // on the thrown error. The service sets `nonRecoverable: true` for
    // poison-message cases (bad UUID, malformed payload) so we drop
    // them rather than spin forever.
    const nonRecoverable = (err as Error & { nonRecoverable?: boolean })
      .nonRecoverable === true;

    if (nonRecoverable) {
      this.logger.warn(
        `[${routingKey}] dropping poison message (dataId=${typeof dataId === 'string' ? dataId : '<missing>'}): ${err.message}`,
      );
      channel.nack(message, false, false);
    } else {
      this.logger.error(
        `[${routingKey}] transient failure (dataId=${typeof dataId === 'string' ? dataId : '<missing>'}): ${err.message}`,
      );
      // Requeue so the broker can retry. A DB outage will eventually
      // heal; the queue is durable so messages survive.
      channel.nack(message, false, true);
    }
  }

  /**
   * First 8 chars of the broker-assigned message id. Used purely for
   * log-correlation — it lets us grep `inventory-service` logs for
   * a specific redelivery without copying the full id around.
   */
  private shortMessageId(message: Message): string {
    const id = message.properties.messageId;
    return typeof id === 'string' && id.length > 0 ? id.slice(0, 8) : '-';
  }
}