import { Injectable } from '@nestjs/common';
import type { Subscription, SubscriptionReader } from '@infragraph/platform';
import { DbService } from '../db/db.service';

const SUB_SELECT = `SELECT id, github_full_name, role, subscribed, appsvn, application_label,
       module_sources_watched, compliance_scope, contacts
FROM subscriptions`;

/**
 * SubscriptionReader backed by live Postgres subscriptions.
 * Resolves identity from DB only — no hardcoded org/repo literals.
 */
@Injectable()
export class DbSubscriptionReader implements SubscriptionReader {
  constructor(private readonly db: DbService) {}

  async get(repoId: string): Promise<Subscription | null> {
    const res = await this.db.query(`${SUB_SELECT} WHERE id = $1`, [repoId]);
    return res.rows.length ? mapRow(res.rows[0]) : null;
  }

  async resolveByFullName(fullName: string): Promise<Subscription | null> {
    if (!fullName) return null;
    const short = fullName.includes('/') ? fullName.split('/')[1] : fullName;
    const res = await this.db.query(
      `${SUB_SELECT}
       WHERE id = $1
          OR github_full_name = $1
          OR github_full_name = $2
          OR split_part(github_full_name, '/', 2) = $3
       LIMIT 1`,
      [fullName, fullName, short],
    );
    return res.rows.length ? mapRow(res.rows[0]) : null;
  }

  async list(): Promise<Subscription[]> {
    const res = await this.db.query(SUB_SELECT);
    return res.rows.map(mapRow);
  }
}

function mapRow(r: any): Subscription {
  return {
    id: r.id,
    githubFullName: r.github_full_name,
    role: r.role,
    subscribed: Boolean(r.subscribed),
    appsvn: r.appsvn ?? undefined,
    applicationLabel: r.application_label ?? undefined,
    moduleSourcesWatched: r.module_sources_watched ?? [],
    complianceScope: r.compliance_scope ?? [],
    contacts: r.contacts ?? {},
  };
}
