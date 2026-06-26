import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { EventsModule } from './events/events.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [
    // Loads .env into process.env globally. No need to call loadDotenv manually.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),

    // Cross-service HTTP. HttpService is provided by @nestjs/axios. We keep
    // a single global instance so the underlying Axios connection pool is
    // shared across modules.
    HttpModule.register({
      timeout: 5_000,
      maxRedirects: 0,
    }),

    // EventsModule is registered globally so any future module that
    // needs to publish product / order / payment events can inject
    // `RabbitMqPublisher` without re-declaring the connection.
    EventsModule,

    PrismaModule,
    HealthModule,
    ProductsModule,
  ],
})
export class AppModule {}