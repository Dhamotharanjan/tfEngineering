import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import neo4j, { Driver } from 'neo4j-driver';
import type { CypherRunner } from '@infragraph/platform';

/** CypherRunner over the API process neo4j-driver (read path for HOT). */
@Injectable()
export class NestCypherRunner implements CypherRunner, OnModuleDestroy {
  private readonly driver: Driver;
  private readonly log = new Logger(NestCypherRunner.name);

  constructor() {
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const pass = process.env.NEO4J_PASSWORD || 'neo4j123';
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));
  }

  async onModuleDestroy() {
    await this.driver.close().catch(() => undefined);
  }

  async read<T = any>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    const session = this.driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const result = await session.run(cypher, params || {});
      return result.records.map((rec) => {
        const obj: Record<string, unknown> = {};
        for (const key of rec.keys) {
          obj[String(key)] = rec.get(key);
        }
        return obj as T;
      });
    } catch (e: any) {
      this.log.warn(`neo4j read failed: ${e?.message || e}`);
      return [];
    } finally {
      await session.close();
    }
  }

  async write<T = any>(_cypher: string, _params?: Record<string, unknown>): Promise<T[]> {
    // HOT path must never write the graph. Refuse at the adapter.
    throw new Error('NestCypherRunner.write is forbidden (HOT path is read-only)');
  }
}
