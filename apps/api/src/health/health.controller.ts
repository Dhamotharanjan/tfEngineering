import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: 'infragraph-api', version: '1.0.0' };
  }
}
