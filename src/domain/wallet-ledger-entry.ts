import type { Money } from './money';

export const LedgerDirection = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
} as const;

export type LedgerDirection =
  (typeof LedgerDirection)[keyof typeof LedgerDirection];

interface LedgerEntryState {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  amount: Money;
  balanceAfter: Money;
}

export class WalletLedgerEntry {
  private constructor(
    readonly walletId: string,
    readonly transactionId: string,
    readonly direction: LedgerDirection,
    readonly amount: Money,
    readonly balanceAfter: Money,
  ) {
    Object.freeze(this);
  }

  static create(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.walletId,
      state.transactionId,
      state.direction,
      state.amount,
      state.balanceAfter,
    );
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return WalletLedgerEntry.create(state);
  }

  isDebit(): boolean {
    return this.direction === LedgerDirection.DEBIT;
  }
}
