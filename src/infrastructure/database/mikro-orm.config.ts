import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';
import { env } from '@/config/env';
import { InboxMessageSchema } from './schemas/inbox-message.schema';
import { OutboxMessageSchema } from './schemas/outbox-message.schema';
import { WagerTransactionSchema } from './schemas/wager-transaction.schema';
import { WalletLedgerEntrySchema } from './schemas/wallet-ledger-entry.schema';
import { WalletSchema } from './schemas/wallet.schema';

export default defineConfig({
  clientUrl: env.databaseUrl,
  entities: [
    WalletSchema,
    WagerTransactionSchema,
    WalletLedgerEntrySchema,
    InboxMessageSchema,
    OutboxMessageSchema,
  ],
  extensions: [Migrator],
  migrations: {
    path: './src/infrastructure/database/migrations',
    pathTs: './src/infrastructure/database/migrations',
    snapshot: false,
    disableForeignKeys: false,
  },
});
