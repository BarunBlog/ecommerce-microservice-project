import { Controller, Get } from '@nestjs/common';

/**
 * /healthz — no auth, used by Docker healthcheck and by compose's
 * `depends_on: condition: service_healthy`. Returns the same shape as
 * category-service's healthz so platform-wide probes stay uniform.
 */
@Controller('healthz')
export class HealthController {
  @Get()
  check(): { status: 'ok'; service: 'product-service' } {
    return { status: 'ok', service: 'product-service' };
  }
}