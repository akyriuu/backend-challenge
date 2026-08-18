import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidAmountError,
} from './errors';
import { Money } from './money';
import { LedgerDirection, WalletLedgerEntry } from './wallet-ledger-entry';

export interface Movement {
  entryId: string;
  transactionId: string;
  money: Money;
  occurredAt: Date;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  openedAt: Date;
  openingEntryId: string;
  openingTransactionId: string;
}

export interface OpenedWallet {
  wallet: Wallet;
  openingEntry: WalletLedgerEntry | null;
}

export class Wallet {
  private constructor(
    readonly id: string,
    readonly playerId: string,
    readonly currency: string,
    private _balance: Money,
    private _version: number,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  /**
   * A carteira nasce já com o saldo inicial, por isso a versão permanece 1:
   * abertura não é alteração de saldo. O lançamento de abertura acompanha a
   * carteira para que não exista caminho em que o saldo nasça sem ledger.
   */
  static open(props: OpenWalletProps): OpenedWallet {
    if (props.initialBalance.isNegative()) {
      throw new InvalidAmountError(props.initialBalance.toString());
    }

    const wallet = new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      props.openedAt,
      props.openedAt,
    );

    if (props.initialBalance.isZero()) {
      return { wallet, openingEntry: null };
    }

    return {
      wallet,
      openingEntry: WalletLedgerEntry.create({
        id: props.openingEntryId,
        walletId: wallet.id,
        transactionId: props.openingTransactionId,
        direction: LedgerDirection.CREDIT,
        money: props.initialBalance,
        balanceBefore: Money.zero(wallet.currency),
        balanceAfter: props.initialBalance,
        createdAt: props.openedAt,
      }),
    };
  }

  /** Reconstrução a partir da persistência — não revalida transições. */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  credit(movement: Movement): WalletLedgerEntry {
    this.assertMovable(movement.money);

    const balanceBefore = this._balance;

    this._balance = this._balance.add(movement.money);
    this._version += 1;
    this._updatedAt = movement.occurredAt;

    return this.record(movement, LedgerDirection.CREDIT, balanceBefore);
  }

  debit(movement: Movement): WalletLedgerEntry {
    this.assertMovable(movement.money);

    if (this._balance.isLessThan(movement.money)) {
      throw new InsufficientFundsError(
        this._balance.toString(),
        movement.money.toString(),
      );
    }

    const balanceBefore = this._balance;

    this._balance = this._balance.subtract(movement.money);
    this._version += 1;
    this._updatedAt = movement.occurredAt;

    return this.record(movement, LedgerDirection.DEBIT, balanceBefore);
  }

  private record(
    movement: Movement,
    direction: LedgerDirection,
    balanceBefore: Money,
  ): WalletLedgerEntry {
    return WalletLedgerEntry.create({
      id: movement.entryId,
      walletId: this.id,
      transactionId: movement.transactionId,
      direction,
      money: movement.money,
      balanceBefore,
      balanceAfter: this._balance,
      createdAt: movement.occurredAt,
    });
  }

  private assertMovable(money: Money): void {
    this.assertSameCurrency(money);

    if (money.isZero()) {
      throw new InvalidAmountError(money.toString());
    }
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
