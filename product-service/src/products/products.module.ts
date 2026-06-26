import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { EventsModule } from '../events/events.module';
import { RabbitMqPublisher } from '../events/rabbitmq.publisher';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * Wires the products feature module.
 *
 * Dependencies (declared elsewhere, resolved through Nest's DI):
 *   - PrismaService  : global, from PrismaModule.
 *   - HttpService    : global, from HttpModule in AppModule.
 *   - ConfigService  : global, from ConfigModule in AppModule.
 *   - RabbitMqPublisher : from EventsModule, imported via the
 *     `imports: [EventsModule]` array below.
 *
 * Local dependencies (declared here):
 *   - The RMQ producer is `RabbitMqPublisher`, NOT
 *     `ClientsModule.register({ transport: Transport.RMQ, ... })`.
 *     See `events/rabbitmq.publisher.ts` for the rationale (Nest's
 *     built-in client publishes to the default exchange, ignoring
 *     the `exchange` config option on `dispatchEvent`).
 */
@Module({
  imports: [HttpModule, EventsModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}