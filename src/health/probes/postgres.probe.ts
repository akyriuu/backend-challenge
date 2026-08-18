import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { HealthProbe } from '../health-probe';

@Injectable()
export class PostgresProbe implements HealthProbe {
  readonly name = 'postgres';

  constructor(private readonly em: EntityManager) {}

  async check(): Promise<void> {
    await this.em.getConnection().execute('select 1');
  }
}
