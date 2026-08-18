import { Money } from '@/domain/money';
import { Wallet } from '@/domain/wallet';
import type { WalletRecord } from '../schemas/wallet.schema';

export const toWalletDomain = (record: WalletRecord): Wallet =>
  Wallet.rehydrate({
    id: record.id,
    playerId: record.playerId,
    currency: record.currency,
    balance: Money.from({
      amount: record.balanceAmount,
      currency: record.currency,
    }),
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });

export const applyWalletToRecord = (
  wallet: Wallet,
  record: WalletRecord,
): void => {
  record.balanceAmount = wallet.balance.toString();
  record.version = wallet.version;
  record.updatedAt = wallet.updatedAt;
};
