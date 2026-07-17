import { BadRequestException, Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService) {}

  @Post('reset-test-data')
  async resetTestData(@Body() body: { confirm?: string }) {
    if (process.env.ALLOW_TEST_DATA_RESET !== 'true') {
      throw new ForbiddenException('Test data reset is disabled');
    }
    if (body?.confirm !== 'RESET') {
      throw new BadRequestException('confirm must be "RESET"');
    }
    return this.admin.resetTestData();
  }
}
