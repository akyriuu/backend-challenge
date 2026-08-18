import { describe, expect, it } from 'bun:test';
import {
  CurrencyMismatchError,
  InvalidAmountError,
  InvalidCurrencyError,
} from './errors';
import { Money } from './money';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });
const usd = (amount: string): Money => Money.from({ amount, currency: 'USD' });

describe('Money', () => {
  describe('construção', () => {
    it('normaliza a escala para duas casas', () => {
      expect(brl('100').toString()).toBe('100.00');
      expect(brl('100.5').toString()).toBe('100.50');
      expect(brl('100.50').toString()).toBe('100.50');
    });

    it('rejeita precisão maior que a escala em vez de arredondar', () => {
      expect(() => brl('1.234')).toThrow(InvalidAmountError);
    });

    it('rejeita representações que não sejam decimais exatos', () => {
      for (const invalido of [
        '',
        'abc',
        '1.2.3',
        '1e3',
        ' 1.00',
        'Infinity',
        'NaN',
      ]) {
        expect(() => brl(invalido)).toThrow(InvalidAmountError);
      }
    });

    it('rejeita valores negativos', () => {
      expect(() => brl('-1.00')).toThrow(InvalidAmountError);
    });

    it('rejeita moeda fora do padrão ISO', () => {
      expect(() => Money.from({ amount: '1.00', currency: 'brl' })).toThrow(
        InvalidCurrencyError,
      );
      expect(() => Money.from({ amount: '1.00', currency: 'BR' })).toThrow(
        InvalidCurrencyError,
      );
    });
  });

  describe('aritmética exata', () => {
    it('soma 0.10 e 0.20 sem erro de ponto flutuante', () => {
      expect(brl('0.10').add(brl('0.20')).toString()).toBe('0.30');
    });

    it('subtrai preservando centavos', () => {
      expect(brl('10.00').subtract(brl('9.99')).toString()).toBe('0.01');
    });

    it('não muta os operandos', () => {
      const saldo = brl('100.00');

      saldo.add(brl('50.00'));

      expect(saldo.toString()).toBe('100.00');
    });

    it('recusa subtração que resultaria em valor negativo', () => {
      expect(() => brl('10.00').subtract(brl('10.01'))).toThrow(
        InvalidAmountError,
      );
    });

    it('recusa operar entre moedas diferentes', () => {
      expect(() => brl('10.00').add(usd('10.00'))).toThrow(
        CurrencyMismatchError,
      );
      expect(() => brl('10.00').subtract(usd('10.00'))).toThrow(
        CurrencyMismatchError,
      );
      expect(() => brl('10.00').isLessThan(usd('10.00'))).toThrow(
        CurrencyMismatchError,
      );
    });
  });

  describe('comparação', () => {
    it('compara por valor, não por identidade', () => {
      expect(brl('10.00').equals(brl('10.0'))).toBe(true);
      expect(brl('10.00').equals(brl('10.01'))).toBe(false);
    });

    it('trata moedas diferentes como não equivalentes, sem lançar', () => {
      expect(brl('10.00').equals(usd('10.00'))).toBe(false);
    });

    it('ordena valores da mesma moeda', () => {
      expect(brl('9.99').isLessThan(brl('10.00'))).toBe(true);
      expect(brl('10.00').isLessThan(brl('9.99'))).toBe(false);
    });

    it('constrói o zero da moeda', () => {
      expect(Money.zero('BRL').toString()).toBe('0.00');
      expect(Money.zero('BRL').isZero()).toBe(true);
    });
  });
});
