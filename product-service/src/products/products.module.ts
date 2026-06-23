import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * Wires the products feature module.
 *
 * Dependencies (declared elsewhere, resolved through Nest's DI):
 *   - PrismaService  : global, from PrismaModule.
 *   - HttpService    : global, from HttpModule in AppModule.
 *   - ConfigService  : global, from ConfigModule in AppModule.
 *
 * Local dependencies (declared here):
 *   - EVENTS_BUS     : RabbitMQ ClientProxy, registered in this module
 *                      via `ClientsModule.register` so the producer
 *                      lives in the same module context as the consumer
 *                      (`ProductsService`). Nest's dynamic-module
 *                      providers do not propagate across module
 *                      boundaries through `imports` — the consumer's
 *                      module must own (or re-export) the provider
 *                      that injects `EVENTS_BUS`.
 */
@Module({
  imports: [
    HttpModule,

    // RabbitMQ microservice transport. We declare a topic exchange
    // named `ecommerce.events`. Other services (notification, search,
    // ...) bind their own queues to this exchange with the routing
    // keys that match the events they care about. product-service
    // never consumes — it only publishes — so we don't bind a queue
    // here at the producer side. The `RABBITMQ_QUEUE` env var is
    // reserved for future consumers.
    ClientsModule.register([
      {
        name: 'EVENTS_BUS',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@rabbitmq:5672'],
          exchange: process.env.RABBITMQ_EXCHANGE ?? 'ecommerce.events',
          exchangeType: 'topic',
          // Producer-only. Persistent on the broker, persistent in the
          // message.
          exchangeOptions: { durable: true },
          persistent: true,
        },
      },
    ]),
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}