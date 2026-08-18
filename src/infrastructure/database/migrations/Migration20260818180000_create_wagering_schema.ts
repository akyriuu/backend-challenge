import { Migration } from '@mikro-orm/migrations';

export class Migration20260818180000_create_wagering_schema extends Migration {
  override up(): void {
    this.addSql(`
      create table wager_transactions (
        id uuid primary key,
        provider_id text not null,
        external_transaction_id text not null,
        idempotency_key text not null,
        payload_hash text not null,
        wallet_id uuid not null references wallets (id),
        player_id uuid not null,
        round_id text not null,
        game_id text not null,
        kind text not null,
        amount numeric(20,2) not null,
        currency char(3) not null,
        reference_external_transaction_id text,
        reference_transaction_id uuid references wager_transactions (id),
        status text not null,
        failure_code text,
        created_at timestamptz not null default now(),
        processed_at timestamptz,

        constraint wager_transactions_kind_known check (
          kind in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')
        ),
        constraint wager_transactions_status_known check (
          status in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')
        ),
        constraint wager_transactions_amount_positive check (amount > 0),
        constraint wager_transactions_currency_iso check (currency ~ '^[A-Z]{3}$'),
        constraint wager_transactions_reference_required check (
          (kind in ('REFUND', 'ROLLBACK'))
            = (reference_external_transaction_id is not null)
        ),
        constraint wager_transactions_failure_code_scope check (
          failure_code is null or status in ('REJECTED', 'FAILED')
        ),
        constraint wager_transactions_processed_at_scope check (
          (status = 'PROCESSED') = (processed_at is not null)
        )
      );
    `);

    this.addSql(`
      create unique index wager_transactions_idempotency_key_uk
        on wager_transactions (idempotency_key);
    `);

    this.addSql(`
      create unique index wager_transactions_provider_external_uk
        on wager_transactions (provider_id, external_transaction_id);
    `);

    this.addSql(`
      create unique index wager_transactions_reversal_uk
        on wager_transactions (reference_transaction_id, kind)
        where reference_transaction_id is not null;
    `);

    this.addSql(`
      create index wager_transactions_pending_reference_idx
        on wager_transactions (created_at)
        where status = 'PENDING_REFERENCE';
    `);

    this.addSql(`
      create table wallet_ledger_entries (
        id uuid primary key,
        wallet_id uuid not null references wallets (id),
        transaction_id uuid not null references wager_transactions (id),
        direction text not null,
        amount numeric(20,2) not null,
        currency char(3) not null,
        balance_before numeric(20,2) not null,
        balance_after numeric(20,2) not null,
        created_at timestamptz not null default now(),

        constraint wallet_ledger_entries_direction_known check (
          direction in ('DEBIT', 'CREDIT')
        ),
        constraint wallet_ledger_entries_amount_positive check (amount > 0),
        constraint wallet_ledger_entries_currency_iso check (currency ~ '^[A-Z]{3}$'),
        constraint wallet_ledger_entries_balances_non_negative check (
          balance_before >= 0 and balance_after >= 0
        ),
        constraint wallet_ledger_entries_balanced check (
          case direction
            when 'DEBIT' then balance_after = balance_before - amount
            else balance_after = balance_before + amount
          end
        )
      );
    `);

    this.addSql(`
      create unique index wallet_ledger_entries_wallet_transaction_uk
        on wallet_ledger_entries (wallet_id, transaction_id);
    `);

    this.addSql(`
      create index wallet_ledger_entries_cursor_idx
        on wallet_ledger_entries (wallet_id, created_at desc, id desc);
    `);

    this.addSql(`
      do $$
      begin
        execute format(
          'revoke update, delete on wallet_ledger_entries from %I',
          current_user
        );
      end
      $$;
    `);

    this.addSql(`
      revoke update, delete on wallet_ledger_entries from public;
    `);

    this.addSql(`
      create table inbox_messages (
        consumer_name text not null,
        message_id text not null,
        payload_hash text not null,
        received_at timestamptz not null default now(),
        processed_at timestamptz,

        primary key (consumer_name, message_id)
      );
    `);

    this.addSql(`
      create table outbox_messages (
        id uuid primary key,
        aggregate_id uuid not null,
        event_type text not null,
        payload jsonb not null,
        occurred_at timestamptz not null,
        attempts integer not null default 0,
        next_attempt_at timestamptz,
        published_at timestamptz,

        constraint outbox_messages_attempts_non_negative check (attempts >= 0)
      );
    `);

    this.addSql(`
      create index outbox_messages_pending_idx
        on outbox_messages (next_attempt_at nulls first, occurred_at)
        where published_at is null;
    `);
  }

  override down(): void {
    this.addSql('drop table if exists outbox_messages;');
    this.addSql('drop table if exists inbox_messages;');
    this.addSql('drop table if exists wallet_ledger_entries;');
    this.addSql('drop table if exists wager_transactions;');
  }
}
