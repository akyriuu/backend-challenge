import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { PendingReferenceStore } from '@/application/ports/pending-reference';
import { env } from '@/config/env';

const DUE_PREDICATE = `
  status = 'PENDING_REFERENCE'
    and reference_attempts < ?
    and now() >= created_at
      + (least(1 << reference_attempts, 300) * interval '1 second')
`;

@Injectable()
export class MikroOrmPendingReferenceStore implements PendingReferenceStore {
  constructor(private readonly em: EntityManager) {}

  async due(limit: number): Promise<string[]> {
    const rows = await this.em.getConnection().execute<{ id: string }[]>(
      `select id from wager_transactions
        where ${DUE_PREDICATE}
        order by created_at
        limit ?`,
      [env.pendingReference.maxAttempts, limit],
    );

    return rows.map((row) => row.id);
  }

  async exhausted(limit: number): Promise<string[]> {
    const rows = await this.em.getConnection().execute<{ id: string }[]>(
      `select id from wager_transactions
        where status = 'PENDING_REFERENCE'
          and reference_attempts >= ?
        order by created_at
        limit ?`,
      [env.pendingReference.maxAttempts, limit],
    );

    return rows.map((row) => row.id);
  }
}
