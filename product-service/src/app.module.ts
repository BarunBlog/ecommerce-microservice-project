import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
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

    // Note: the RabbitMQ `EVENTS_BUS` ClientProxy is registered inside
    // ProductsModule (not here) so the provider lives in the same
    // module context as the consumer that injects it. Dynamic-module
    // providers from `ClientsModule.register` are scoped to the
    // importing module — they do not propagate to other modules
    // through `imports`.

    PrismaModule,
    HealthModule,
    ProductsModule,
  ],
})
export class AppModule {}