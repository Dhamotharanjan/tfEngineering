import { Controller, Post } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

@Controller('scheduler')
export class SchedulerController {
  constructor(private scheduler: SchedulerService) {}

  /** Manual trigger for nightly reconcile (ops / demo). */
  @Post('reconcile')
  async reconcileNow() {
    return this.scheduler.enqueueReconcileAll();
  }
}
