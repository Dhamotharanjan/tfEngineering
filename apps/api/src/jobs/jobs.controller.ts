import { Controller, Get, Query } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Controller('jobs')
export class JobsController {
  constructor(private db: DbService) {}

  @Get()
  async list(@Query('limit') limit = '20') {
    const res = await this.db.query(
      `SELECT id, job_type, priority, repo_id, status, created_at, completed_at FROM scan_jobs ORDER BY created_at DESC LIMIT $1`,
      [parseInt(limit as string, 10)],
    );
    return res.rows.map((r) => ({
      id: r.id,
      type: r.job_type,
      priority: r.priority,
      target: r.repo_id,
      status: r.status,
      duration: r.completed_at ? 'completed' : '—',
    }));
  }
}
