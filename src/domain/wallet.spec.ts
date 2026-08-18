import { describe, expect, it } from 'bun:test';
import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidAmountError,
} from './errors';
import { Money } from './money';
import { Wallet } from './wallet';
import { LedgerDirection } from './wallet-ledger-entry';

const WALLET_ID = '018f0e3a-0000-7000-8000-000000000001';
const PLAYER_ID = '018f0e3a-0000-7000-8000-000000000002';
const TRANSACTION_ID = '018f0e3a-0000-7000-8000-000000000003';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

const walletComSaldo = (amount: string): Wallet =>
  Wallet.rehydrate({
    id: WALLET_ID,
    playerId: PLAYER_ID,
    balance: brl(amount),
    version: 1,
  });

describe('Wallet', () => {
  describe('abertura', () => {
    it('nasce zerada, na versão inicial', () => {
      const wallet = Wallet.open({
        id: WALLET_ID,
        playerId: PLAYER_ID,
        currency: 'BRL',
      });

      expect(wallet.balance.toString()).toBe('0.00');
      expect(wallet.version).toBe(1);
      expect(wallet.currency).toBe('BRL');
    });
  });

  describe('crédito', () => {
    it('aumenta o saldo e produz lançamento com o saldo resultante', () => {
      const wallet = walletComSaldo('100.00');

      const entry = wallet.credit({
        transactionId: TRANSACTION_ID,
        amount: brl('50.00'),
      });

      expect(wallet.balance.toString()).toBe('150.00');
      expect(wallet.version).toBe(2);
      expect(entry.direction).toBe(LedgerDirection.CREDIT);
      expect(entry.amount.toString()).toBe('50.00');
      expect(entry.balanceAfter.toString()).toBe('150.00');
      expect(entry.walletId).toBe(WALLET_ID);
      expect(entry.transactionId).toBe(TRANSACTION_ID);
    });
  });

  describe('débito', () => {
    it('reduz o saldo e produz lançamento com o saldo resultante', () => {
      const wallet = walletComSaldo('100.00');

      const entry = wallet.debit({
        transactionId: TRANSACTION_ID,
        amount: brl('80.00'),
      });

      expect(wallet.balance.toString()).toBe('20.00');
      expect(wallet.version).toBe(2);
      expect(entry.direction).toBe(LedgerDirection.DEBIT);
      expect(entry.balanceAfter.toString()).toBe('20.00');
    });

    it('permite zerar o saldo exatamente', () => {
      const wallet = walletComSaldo('100.00');

      wallet.debit({ transactionId: TRANSACTION_ID, amount: brl('100.00') });

      expect(wallet.balance.isZero()).toBe(true);
    });

    it('recusa débito acima do saldo sem alterar o estado', () => {
      const wallet = walletComSaldo('100.00');

      expect(() =>
        wallet.debit({ transactionId: TRANSACTION_ID, amount: brl('100.01') }),
      ).toThrow(InsufficientFundsError);

      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
    });
  });

  describe('invariantes comuns aos dois comandos', () => {
    it('recusa movimento de valor zero', () => {
      const wallet = walletComSaldo('100.00');

      expect(() =>
        wallet.debit({ transactionId: TRANSACTION_ID, amount: brl('0') }),
      ).toThrow(InvalidAmountError);
      expect(() =>
        wallet.credit({ transactionId: TRANSACTION_ID, amount: brl('0') }),
      ).toThrow(InvalidAmountError);
    });

    it('recusa movimento em moeda diferente da carteira', () => {
      const wallet = walletComSaldo('100.00');
      const dolar = Money.from({ amount: '10.00', currency: 'USD' });

      expect(() =>
        wallet.debit({ transactionId: TRANSACTION_ID, amount: dolar }),
      ).toThrow(CurrencyMismatchError);
    });
  });

  describe('consistência com o ledger', () => {
    it('o saldo final equivale à reconstrução a partir dos lançamentos', () => {
      const wallet = Wallet.open({
        id: WALLET_ID,
        playerId: PLAYER_ID,
        currency: 'BRL',
      });

      const entries = [
        wallet.credit({ transactionId: TRANSACTION_ID, amount: brl('100.00') }),
        wallet.debit({ transactionId: TRANSACTION_ID, amount: brl('80.00') }),
        wallet.credit({ transactionId: TRANSACTION_ID, amount: brl('12.34') }),
      ];

      const reconstruido = entries.reduce(
        (saldo, entry) =>
          entry.isDebit()
            ? saldo.subtract(entry.amount)
            : saldo.add(entry.amount),
        Money.zero('BRL'),
      );

      expect(reconstruido.toString()).toBe(wallet.balance.toString());
      expect(wallet.version).toBe(4);
    });
  });
});
