import { Decimal } from 'decimal.js';
import {
  CurrencyMismatchError,
  InvalidAmountError,
  InvalidCurrencyError,
} from './errors';

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const SCALE = 2;

export class Money {
  private constructor(
    private readonly value: Decimal,
    readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static from({
    amount,
    currency,
  }: {
    amount: string;
    currency: string;
  }): Money {
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new InvalidCurrencyError(currency);
    }

    if (!AMOUNT_PATTERN.test(amount)) {
      throw new InvalidAmountError(amount);
    }

    return new Money(new Decimal(amount), currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0', currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);

    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);

    const result = this.value.minus(other.value);

    if (result.isNegative()) {
      throw new InvalidAmountError(result.toString());
    }

    return new Money(result, this.currency);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);

    return this.value.lessThan(other.value);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);

    return this.value.greaterThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  toString(): string {
    // Decimal.prototype.toFixed é aritmética decimal exata — nada a ver com
    // Number.prototype.toFixed, que a guarda do domínio proíbe por arredondar
    // ponto flutuante. É a única forma de preservar o zero à direita exigido
    // pela escala de numeric(20,2).
    // eslint-disable-next-line no-restricted-syntax
    return this.value.toFixed(SCALE);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
