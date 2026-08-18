import { describe, expect, it } from 'bun:test';
import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidAmountError,
} from './errors';
import { Money } from './money';
import { Wallet, type Movement } from './wallet';
import { LedgerDirection } from './wallet-ledger-entry';

const WALLET_ID = '018f0e3a-0000-7000-8000-000000000001';
const PLAYER_ID = '018f0e3a-0000-7000-8000-000000000002';
const TRANSACTION_ID = '018f0e3a-0000-7000-8000-000000000003';
const ENTRY_ID = '018f0e3a-0000-7000-8000-000000000004';
const ENTRY_ID_2 = '018f0e3a-0000-7000-8000-000000000005';
const ENTRY_ID_3 = '018f0e3a-0000-7000-8000-000000000006';
const OPENING_ENTRY_ID = '018f0e3a-0000-7000-8000-000000000007';
const OPENING_TRANSACTION_ID = '018f0e3a-0000-7000-8000-000000000008';
const OPENED_AT = new Date('2026-08-18T12:00:00.000Z');
const OCCURRED_AT = new Date('2026-08-18T13:00:00.000Z');

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

const movimento = (money: Money, entryId: string = ENTRY_ID): Movement => ({
  entryId,
  transactionId: TRANSACTION_ID,
  money,
  occurredAt: OCCURRED_AT,
});

const abrir = (initialBalance: string) =>
  Wallet.open({
    id: WALLET_ID,
    playerId: PLAYER_ID,
    initialBalance: brl(initialBalance),
    openedAt: OPENED_AT,
    openingEntryId: OPENING_ENTRY_ID,
    openingTransactionId: OPENING_TRANSACTION_ID,
  });

const walletComSaldo = (amount: string): Wallet =>
  Wallet.rehydrate({
    id: WALLET_ID,
    playerId: PLAYER_ID,
    currency: 'BRL',
    balance: brl(amount),
    version: 1,
    createdAt: OPENED_AT,
    updatedAt: OPENED_AT,
  });

describe('Wallet', () => {
  describe('abertura', () => {
    it('nasce com o saldo inicial, ainda na versão 1', () => {
      const { wallet } = abrir('1000.00');

      expect(wallet.balance.toString()).toBe('1000.00');
      expect(wallet.version).toBe(1);
      expect(wallet.currency).toBe('BRL');
      expect(wallet.createdAt).toBe(OPENED_AT);
      expect(wallet.updatedAt).toBe(OPENED_AT);
    });

    it('produz o lançamento de abertura partindo de zero', () => {
      const { openingEntry } = abrir('1000.00');

      expect(openingEntry).not.toBeNull();
      expect(openingEntry?.direction).toBe(LedgerDirection.CREDIT);
      expect(openingEntry?.money.toString()).toBe('1000.00');
      expect(openingEntry?.balanceBefore.toString()).toBe('0.00');
      expect(openingEntry?.balanceAfter.toString()).toBe('1000.00');
      expect(openingEntry?.transactionId).toBe(OPENING_TRANSACTION_ID);
      expect(openingEntry?.isBalanced()).toBe(true);
    });

    it('não produz lançamento quando abre zerada', () => {
      const { wallet, openingEntry } = abrir('0');

      expect(wallet.balance.isZero()).toBe(true);
      expect(openingEntry).toBeNull();
    });

    it('recusa saldo inicial negativo', () => {
      expect(() =>
        Wallet.open({
          id: WALLET_ID,
          playerId: PLAYER_ID,
          initialBalance: brl('10.00').negate(),
          openedAt: OPENED_AT,
          openingEntryId: OPENING_ENTRY_ID,
          openingTransactionId: OPENING_TRANSACTION_ID,
        }),
      ).toThrow(InvalidAmountError);
    });
  });

  describe('crédito', () => {
    it('aumenta o saldo e produz lançamento consistente', () => {
      const wallet = walletComSaldo('100.00');

      const entry = wallet.credit(movimento(brl('50.00')));

      expect(wallet.balance.toString()).toBe('150.00');
      expect(wallet.version).toBe(2);
      expect(wallet.updatedAt).toBe(OCCURRED_AT);
      expect(entry.direction).toBe(LedgerDirection.CREDIT);
      expect(entry.money.toString()).toBe('50.00');
      expect(entry.balanceBefore.toString()).toBe('100.00');
      expect(entry.balanceAfter.toString()).toBe('150.00');
      expect(entry.isBalanced()).toBe(true);
      expect(entry.id).toBe(ENTRY_ID);
      expect(entry.walletId).toBe(WALLET_ID);
      expect(entry.transactionId).toBe(TRANSACTION_ID);
      expect(entry.createdAt).toBe(OCCURRED_AT);
    });
  });

  describe('débito', () => {
    it('reduz o saldo e produz lançamento consistente', () => {
      const wallet = walletComSaldo('100.00');

      const entry = wallet.debit(movimento(brl('80.00')));

      expect(wallet.balance.toString()).toBe('20.00');
      expect(wallet.version).toBe(2);
      expect(entry.direction).toBe(LedgerDirection.DEBIT);
      expect(entry.balanceBefore.toString()).toBe('100.00');
      expect(entry.balanceAfter.toString()).toBe('20.00');
      expect(entry.isBalanced()).toBe(true);
    });

    it('permite zerar o saldo exatamente', () => {
      const wallet = walletComSaldo('100.00');

      const entry = wallet.debit(movimento(brl('100.00')));

      expect(wallet.balance.isZero()).toBe(true);
      expect(entry.balanceAfter.toString()).toBe('0.00');
    });

    it('recusa débito acima do saldo sem alterar o estado', () => {
      const wallet = walletComSaldo('100.00');

      expect(() => wallet.debit(movimento(brl('100.01')))).toThrow(
        InsufficientFundsError,
      );

      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(wallet.updatedAt).toBe(OPENED_AT);
    });
  });

  describe('invariantes comuns aos dois comandos', () => {
    it('recusa movimento de valor zero', () => {
      const wallet = walletComSaldo('100.00');

      expect(() => wallet.debit(movimento(Money.zero('BRL')))).toThrow(
        InvalidAmountError,
      );
      expect(() => wallet.credit(movimento(Money.zero('BRL')))).toThrow(
        InvalidAmountError,
      );
    });

    it('recusa movimento em moeda diferente da carteira', () => {
      const wallet = walletComSaldo('100.00');
      const dolar = Money.from({ amount: '10.00', currency: 'USD' });

      expect(() => wallet.debit(movimento(dolar))).toThrow(
        CurrencyMismatchError,
      );
      expect(() => wallet.credit(movimento(dolar))).toThrow(
        CurrencyMismatchError,
      );
    });
  });

  describe('consistência com o ledger', () => {
    it('o saldo final equivale à reconstrução a partir dos lançamentos', () => {
      const { wallet, openingEntry } = abrir('100.00');

      const entries = [
        openingEntry,
        wallet.debit(movimento(brl('80.00'), ENTRY_ID_2)),
        wallet.credit(movimento(brl('12.34'), ENTRY_ID_3)),
      ].filter((entry) => entry !== null);

      const reconstruido = entries.reduce(
        (saldo, entry) =>
          entry.isDebit()
            ? saldo.subtract(entry.money)
            : saldo.add(entry.money),
        Money.zero('BRL'),
      );

      expect(reconstruido.toString()).toBe(wallet.balance.toString());
      expect(reconstruido.toString()).toBe('32.34');
      expect(wallet.version).toBe(3);
    });

    it('a cadeia de lançamentos encadeia saldo anterior e posterior', () => {
      const wallet = walletComSaldo('100.00');

      const primeiro = wallet.credit(movimento(brl('50.00'), ENTRY_ID));
      const segundo = wallet.debit(movimento(brl('30.00'), ENTRY_ID_2));

      expect(segundo.balanceBefore.toString()).toBe(
        primeiro.balanceAfter.toString(),
      );
    });
  });
});
