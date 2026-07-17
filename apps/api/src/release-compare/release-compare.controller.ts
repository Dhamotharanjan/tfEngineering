import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ReleaseCompareService } from './release-compare.service';

@Controller('release-compare')
export class ReleaseCompareController {
  constructor(private svc: ReleaseCompareService) {}

  @Get('modules')
  listModules() {
    return this.svc.listModules();
  }

  @Get('modules/:moduleId/releases')
  listReleases(@Param('moduleId') moduleId: string) {
    return this.svc.listReleases(moduleId);
  }

  @Get('compare')
  compare(
    @Query('moduleId') moduleId: string,
    @Query('from') fromVersion: string,
    @Query('to') toVersion: string,
  ) {
    if (!moduleId || !fromVersion || !toVersion) {
      return {
        error: 'missing_params',
        message: 'Query params moduleId, from, and to are required',
      };
    }
    return this.svc.compare(moduleId, fromVersion, toVersion);
  }

  @Post('compare')
  comparePost(
    @Body()
    body: { moduleId: string; fromVersion: string; toVersion: string },
  ) {
    if (!body?.moduleId || !body?.fromVersion || !body?.toVersion) {
      return {
        error: 'missing_params',
        message: 'Body fields moduleId, fromVersion, and toVersion are required',
      };
    }
    return this.svc.compare(body.moduleId, body.fromVersion, body.toVersion);
  }

  @Get('approvers')
  listApprovers() {
    return this.svc.listApprovers();
  }

  @Post('raise-pr')
  raisePr(
    @Body()
    body: {
      repo_id: string;
      module_id: string;
      from_version: string;
      to_version: string;
      title?: string;
      body?: string;
      dry_run?: boolean;
    },
  ) {
    if (!body?.repo_id || !body?.module_id || !body?.from_version || !body?.to_version) {
      return {
        error: 'missing_params',
        message: 'repo_id, module_id, from_version, and to_version are required',
      };
    }
    return this.svc.raisePr(body);
  }

  @Post('raise-pr/bulk')
  async raisePrBulk(
    @Body()
    body: {
      repo_ids: string[];
      module_id: string;
      from_version: string;
      to_version: string;
    },
  ) {
    if (!body?.repo_ids?.length || !body?.module_id || !body?.from_version || !body?.to_version) {
      return {
        error: 'missing_params',
        message: 'repo_ids[], module_id, from_version, and to_version are required',
      };
    }
    const results = [];
    for (const repo_id of body.repo_ids) {
      results.push(
        await this.svc.raisePr({
          repo_id,
          module_id: body.module_id,
          from_version: body.from_version,
          to_version: body.to_version,
        }),
      );
    }
    return { count: results.length, results };
  }

  @Get('pr-requests')
  listPrRequests(@Query('limit') limit?: string) {
    return this.svc.listPrRequests(limit ? Number(limit) : 50);
  }

  @Get('pr-requests/:id')
  getPrRequest(@Param('id') id: string) {
    return this.svc.getPrRequest(id);
  }

  @Post('pr-requests/:id/approve')
  approve(
    @Param('id') id: string,
    @Body() body: { approver: string; comment?: string },
  ) {
    if (!body?.approver) {
      return { error: 'missing_params', message: 'approver is required' };
    }
    return this.svc.approvePrRequest(id, body);
  }

  @Post('pr-requests/:id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: { approver: string; comment?: string },
  ) {
    if (!body?.approver) {
      return { error: 'missing_params', message: 'approver is required' };
    }
    return this.svc.rejectPrRequest(id, body);
  }

  @Post('pr-requests/:id/proceed')
  proceed(@Param('id') id: string) {
    return this.svc.proceedPrRequest(id);
  }

  @Post('pr-requests/:id/chat')
  chat(
    @Param('id') id: string,
    @Body() body: { message: string; persist?: boolean },
  ) {
    if (!body?.message?.trim()) {
      return { error: 'missing_params', message: 'message is required' };
    }
    return this.svc.chatPrRequest(id, body);
  }
}
