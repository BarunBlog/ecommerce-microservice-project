import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin wrapper over PrismaClient that plugs into Nest's lifecycle.
 *
 *   - $connect() runs on module init so the first request doesn't pay
 *     the connection cost.
 *   - $disconnect() runs on shutdown so docker stop is graceful and we
 *     don't leak sockets in the Postgres container.
 *
 * Marked @Global via PrismaModule so any feature module can inject
 * PrismaService without re-importing the module.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected from PostgreSQL');
  }
}