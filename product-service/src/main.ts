import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Global /api prefix to match category-service's route shape
  // (`/api/<resource>/...`). Applied to every controller in one place
  // so feature modules don't have to repeat 'api' in their @Controller
  // decorator. Note: Nest does NOT add a trailing slash, so URLs are
  // `/api/products`, not `/api/products/` — see README for the
  // convention.
  app.setGlobalPrefix('api');

  // Global validation: DTOs are enforced with class-validator. `whitelist`
  // strips unknown fields, `forbidNonWhitelisted` rejects them outright so
  // a client passing `slug` (server-generated) gets a 400, not silent drop.
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

  await app.listen(port, '0.0.0.0');

  Logger.log(
    `product-service listening on http://0.0.0.0:${port}`,
    'Bootstrap',
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during bootstrap', err);
  process.exit(1);
});