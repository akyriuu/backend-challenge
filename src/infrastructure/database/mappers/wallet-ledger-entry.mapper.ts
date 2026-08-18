import { Money } from '@/domain/money';
import { WalletLedgerEntry } from '@/domain/wallet-ledger-entry';
import type { WalletLedgerEntryRecord } from '../schemas/wallet-ledger-entry.schema';

export const toLedgerEntryRecordData = (
  entry: WalletLedgerEntry,
): WalletLedgerEntryRecord => ({
  id: entry.id,
  walletId: entry.walletId,
  transactionId: entry.transactionId,
  direction: entry.direction,
  amount: entry.money.toString(),
  currency: entry.money.currency,
  balanceBefore: entry.balanceBefore.toString(),
  balanceAfter: entry.balanceAfter.toString(),
  createdAt: entry.createdAt,
});

export const toLedgerEntryDomain = (
  record: WalletLedgerEntryRecord,
): WalletLedgerEntry =>
  WalletLedgerEntry.rehydrate({
    id: record.id,
    walletId: record.walletId,
    transactionId: record.transactionId,
    direction: record.direction,
    money: Money.from({ amount: record.amount, currency: record.currency }),
    balanceBefore: Money.from({
      amount: record.balanceBefore,
      currency: record.currency,
    }),
    balanceAfter: Money.from({
      amount: record.balanceAfter,
      currency: record.currency,
    }),
    createdAt: record.createdAt,
  });
