import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidAmountError,
} from './errors';
import { Money } from './money';
import { LedgerDirection, WalletLedgerEntry } from './wallet-ledger-entry';

interface Movement {
  transactionId: string;
  amount: Money;
}

export class Wallet {
  private constructor(
    readonly id: string,
    readonly playerId: string,
    private _balance: Money,
    private _version: number,
  ) {}

  static open(state: {
    id: string;
    playerId: string;
    currency: string;
  }): Wallet {
    return new Wallet(state.id, state.playerId, Money.zero(state.currency), 1);
  }

  static rehydrate(state: {
    id: string;
    playerId: string;
    balance: Money;
    version: number;
  }): Wallet {
    return new Wallet(state.id, state.playerId, state.balance, state.version);
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get currency(): string {
    return this._balance.currency;
  }

  credit(movement: Movement): WalletLedgerEntry {
    this.assertMovable(movement.amount);

    this._balance = this._balance.add(movement.amount);
    this._version += 1;

    return this.record(movement, LedgerDirection.CREDIT);
  }

  debit(movement: Movement): WalletLedgerEntry {
    this.assertMovable(movement.amount);

    if (this._balance.isLessThan(movement.amount)) {
      throw new InsufficientFundsError(
        this._balance.toString(),
        movement.amount.toString(),
      );
    }

    this._balance = this._balance.subtract(movement.amount);
    this._version += 1;

    return this.record(movement, LedgerDirection.DEBIT);
  }

  private record(
    movement: Movement,
    direction: LedgerDirection,
  ): WalletLedgerEntry {
    return WalletLedgerEntry.create({
      walletId: this.id,
      transactionId: movement.transactionId,
      direction,
      amount: movement.amount,
      balanceAfter: this._balance,
    });
  }

  private assertMovable(amount: Money): void {
    if (amount.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, amount.currency);
    }

    if (amount.isZero()) {
      throw new InvalidAmountError(amount.toString());
    }
  }
}
