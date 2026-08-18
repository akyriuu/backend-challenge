import { InvalidAmountError, UnbalancedLedgerEntryError } from './errors';
import type { Money } from './money';

export const LedgerDirection = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
} as const;

export type LedgerDirection =
  (typeof LedgerDirection)[keyof typeof LedgerDirection];

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export class WalletLedgerEntry {
  private constructor(
    readonly id: string,
    readonly walletId: string,
    readonly transactionId: string,
    readonly direction: LedgerDirection,
    readonly money: Money,
    readonly balanceBefore: Money,
    readonly balanceAfter: Money,
    readonly createdAt: Date,
  ) {
    Object.freeze(this);
  }

  static create(state: LedgerEntryState): WalletLedgerEntry {
    if (!state.money.isPositive()) {
      throw new InvalidAmountError(state.money.toString());
    }

    const entry = WalletLedgerEntry.rehydrate(state);

    if (!entry.isBalanced()) {
      throw new UnbalancedLedgerEntryError(
        `${state.balanceBefore.toString()} sob ${state.direction} de ${state.money.toString()} não resulta em ${state.balanceAfter.toString()}`,
      );
    }

    if (entry.balanceAfter.isNegative()) {
      throw new UnbalancedLedgerEntryError(
        `saldo resultante negativo: ${state.balanceAfter.toString()}`,
      );
    }

    return entry;
  }

  /** Reconstrução do que já está persistido: não revalida a aritmética. */
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  isDebit(): boolean {
    return this.direction === LedgerDirection.DEBIT;
  }

  isBalanced(): boolean {
    const currency = this.balanceBefore.currency;

    if (
      this.money.currency !== currency ||
      this.balanceAfter.currency !== currency
    ) {
      return false;
    }

    const projected = this.isDebit()
      ? this.balanceBefore.subtract(this.money)
      : this.balanceBefore.add(this.money);

    return projected.equals(this.balanceAfter);
  }
}
