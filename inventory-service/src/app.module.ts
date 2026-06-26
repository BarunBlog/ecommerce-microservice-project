import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { InventoryModule } from './inventory/inventory.module';

@Module({
  imports: [
    // Loads .env into process.env globally. No need to call loadDotenv manually.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),

    PrismaModule,
    HealthModule,
    InventoryModule,
  ],
})
export class AppModule {}