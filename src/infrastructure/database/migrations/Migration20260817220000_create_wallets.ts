import { Migration } from '@mikro-orm/migrations';

export class Migration20260817220000_create_wallets extends Migration {
  override up(): void {
    this.addSql(`
      create table wallets (
        id uuid primary key,
        player_id uuid not null,
        currency char(3) not null,
        balance_amount numeric(20,2) not null,
        version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint wallets_balance_non_negative check (balance_amount >= 0),
        constraint wallets_currency_iso check (currency ~ '^[A-Z]{3}$'),
        constraint wallets_version_positive check (version >= 1)
      );
    `);

    this.addSql(`
      create unique index wallets_player_currency_uk
        on wallets (player_id, currency);
    `);
  }

  override down(): void {
    this.addSql('drop table if exists wallets;');
  }
}
