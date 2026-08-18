import { defineEntity, p, type InferEntity } from '@mikro-orm/core';
import type { LedgerDirection } from '@/domain/wallet-ledger-entry';

export const WalletLedgerEntrySchema = defineEntity({
  name: 'WalletLedgerEntry',
  tableName: 'wallet_ledger_entries',
  properties: {
    id: p.uuid().primary(),
    walletId: p.uuid(),
    transactionId: p.uuid(),
    direction: p.string().$type<LedgerDirection>(),
    amount: p.decimal(),
    currency: p.string(),
    balanceBefore: p.decimal(),
    balanceAfter: p.decimal(),
    createdAt: p.datetime(),
  },
});

export type WalletLedgerEntryRecord = InferEntity<
  typeof WalletLedgerEntrySchema
>;
