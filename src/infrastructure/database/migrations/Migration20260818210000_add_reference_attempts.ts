import { Migration } from '@mikro-orm/migrations';

export class Migration20260818210000_add_reference_attempts extends Migration {
  override up(): void {
    this.addSql(`
      alter table wager_transactions
        add column reference_attempts integer not null default 0;
    `);

    this.addSql(`
      alter table wager_transactions
        add constraint wager_transactions_reference_attempts_non_negative
        check (reference_attempts >= 0);
    `);
  }

  override down(): void {
    this.addSql(`
      alter table wager_transactions
        drop constraint if exists wager_transactions_reference_attempts_non_negative;
    `);

    this.addSql(`
      alter table wager_transactions drop column if exists reference_attempts;
    `);
  }
}
