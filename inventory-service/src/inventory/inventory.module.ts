import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { InventoryController } from './inventory.controller';
import { InventoryConsumer } from './inventory.consumer';
import { InventoryService } from './inventory.service';

/**
 * Wires the inventory feature module.
 *
 * Local dependencies (declared here):
 *   - INVENTORY_MICROSERVICE : RabbitMQ microservice transport. Bound
 *      to the same `ecommerce.events` topic exchange that
 *      product-service publishes to, with a durable queue named
 *      via `RABBITMQ_QUEUE`. The queue is declared with
 *      `noAssert: false` so we get a clear error if the exchange
 *      does not exist (which usually means infra/docker-compose.yml
 *      has not been brought up yet — see root Makefile `infra-up`).
 *
 *      We do NOT publish to this transport; the controller only
 *      consumes (`@EventPattern`). The `name` token is kept because
 *      Nest's `ClientsModule.register` requires it, even though we
 *      never `@Inject()` it.
 *
 * Resolved through Nest's DI from elsewhere:
 *   - PrismaService : global, from PrismaModule.
 *   - ConfigService : global, from ConfigModule (AppModule).
 */
@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'INVENTORY_MICROSERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [
            process.env.RABBITMQ_URL ?? 'amqp://guest:guest@rabbitmq:5672',
          ],
          exchange: process.env.RABBITMQ_EXCHANGE ?? 'ecommerce.events',
          exchangeType: 'topic',
          exchangeOptions: {
            durable: true,
          },
          // Consumer-side: this service owns the queue. Durable so a
          // broker restart does not lose pending events. The queue
          // name is configurable via RABBITMQ_QUEUE in .env so we
          // can run two consumers side-by-side in dev if needed.
          queue: process.env.RABBITMQ_QUEUE ?? 'inventory-service.products.created',
          queueOptions: {
            durable: true,
          },
          // Bind ONLY the routing key we care about. product-service
          // also publishes `products.event.updated` and
          // `products.event.deleted`; we ignore those for now
          // (AGENTS.md §7.1.10 — consumers declare their own bindings).
          routingKey: 'products.event.created',
          // Manual ack in the controller so a DB outage requeues
          // (well, nacks-without-requeue; see controller comments).
          noAck: false,
        },
      },
    ]),
  ],
  controllers: [InventoryController, InventoryConsumer],
  providers: [InventoryService],
})
export class InventoryModule {}