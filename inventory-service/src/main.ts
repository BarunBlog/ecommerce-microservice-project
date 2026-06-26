import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Hybrid app: HTTP server (Express) + RabbitMQ microservice consumer
  // in the same Nest instance and DI graph. We boot the HTTP side
  // first, then attach RMQ via connectMicroservice(), then start
  // everything with startAllMicroservices() + listen().
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Global /api prefix to match category-service and product-service
  // route shapes (`/api/<resource>/...`). Applied to every controller
  // in one place so feature modules don't have to repeat 'api' in
  // their @Controller decorator. Nest does NOT add a trailing slash,
  // so URLs are `/api/inventory`, not `/api/inventory/`.
  app.setGlobalPrefix('api');

  // Global validation: DTOs are enforced with class-validator. `whitelist`
  // strips unknown fields, `forbidNonWhitelisted` rejects them outright so
  // a client passing a server-generated field gets a 400, not silent drop.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = app.get(ConfigService);
  const port = Number(config.get<string>('PORT', '8000'));
  const rabbitUrl =
    config.get<string>('RABBITMQ_URL') ?? 'amqp://guest:guest@rabbitmq:5672';
  const exchange =
    config.get<string>('RABBITMQ_EXCHANGE') ?? 'ecommerce.events';
  const queue =
    config.get<string>('RABBITMQ_QUEUE') ??
    'inventory-service.products.created';

  // Attach the RMQ microservice transport. We duplicate the transport
  // options here (rather than re-using InventoryModule's
  // ClientsModule.register) because Nest requires the consumer config
  // to be passed to `connectMicroservice` at boot. The two
  // configurations must stay in sync — both bind the same durable
  // queue to the same topic exchange with the same routing key. If
  // you change one, change both.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rabbitUrl],
      exchange,
      exchangeType: 'topic',
      exchangeOptions: { durable: true },
      queue,
      queueOptions: { durable: true },
      routingKey: 'products.event.*',
      noAck: false,
    },
  });

  // Start the microservice transport BEFORE the HTTP server so the
  // consumer is bound and listening the moment the container reports
  // healthy. startAllMicroservices() is idempotent — calling it
  // before listen() means an RMQ outage will fail boot loudly rather
  // than being discovered by a publish event after startup.
  await app.startAllMicroservices();

  await app.listen(port, '0.0.0.0');

  Logger.log(
    `inventory-service listening on http://0.0.0.0:${port}`,
    'Bootstrap',
  );
  Logger.log(
    `inventory-service RMQ consumer bound to ${exchange} (queue=${queue}, routingKey=products.event.created)`,
    'Bootstrap',
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during bootstrap', err);
  process.exit(1);
});