import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  pool: Pool;

  async onModuleInit() {
    const dsn = process.env.POSTGRES_DSN || 'postgresql://tfengineering:tfengineering123@localhost:5432/tfengineering';
    this.pool = new Pool({ connectionString: dsn });
    const schemaPath = path.join(process.env.PROJECT_ROOT || '/app', 'config', 'postgres', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await this.pool.query(sql).catch((e) => console.warn('schema init:', e.message));
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  async query(text: string, params?: any[]) {
    return this.pool.query(text, params);
  }
}
