import { describe, expect, it } from 'bun:test';
import { InvalidAmountError, UnbalancedLedgerEntryError } from './errors';
import { Money } from './money';
import {
  LedgerDirection,
  WalletLedgerEntry,
  type LedgerEntryState,
} from './wallet-ledger-entry';

const ENTRY_ID = '018f0e3a-0000-7000-8000-000000000001';
const WALLET_ID = '018f0e3a-0000-7000-8000-000000000002';
const TRANSACTION_ID = '018f0e3a-0000-7000-8000-000000000003';
const CREATED_AT = new Date('2026-08-18T12:00:00.000Z');

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

const state = (
  overrides: Partial<LedgerEntryState> = {},
): LedgerEntryState => ({
  id: ENTRY_ID,
  walletId: WALLET_ID,
  transactionId: TRANSACTION_ID,
  direction: LedgerDirection.DEBIT,
  money: brl('80.00'),
  balanceBefore: brl('100.00'),
  balanceAfter: brl('20.00'),
  createdAt: CREATED_AT,
  ...overrides,
});

describe('WalletLedgerEntry', () => {
  describe('criação', () => {
    it('aceita débito cuja aritmética fecha', () => {
      const entry = WalletLedgerEntry.create(state());

      expect(entry.isDebit()).toBe(true);
      expect(entry.isBalanced()).toBe(true);
      expect(entry.balanceAfter.toString()).toBe('20.00');
      expect(entry.createdAt).toBe(CREATED_AT);
    });

    it('aceita crédito cuja aritmética fecha', () => {
      const entry = WalletLedgerEntry.create(
        state({
          direction: LedgerDirection.CREDIT,
          money: brl('50.00'),
          balanceBefore: brl('100.00'),
          balanceAfter: brl('150.00'),
        }),
      );

      expect(entry.isDebit()).toBe(false);
      expect(entry.isBalanced()).toBe(true);
    });

    it('recusa débito cujo saldo resultante não corresponde', () => {
      expect(() =>
        WalletLedgerEntry.create(state({ balanceAfter: brl('20.01') })),
      ).toThrow(UnbalancedLedgerEntryError);
    });

    it('recusa crédito lançado com a aritmética de débito', () => {
      expect(() =>
        WalletLedgerEntry.create(state({ direction: LedgerDirection.CREDIT })),
      ).toThrow(UnbalancedLedgerEntryError);
    });

    it('recusa lançamento de valor zero', () => {
      expect(() =>
        WalletLedgerEntry.create(
          state({ money: Money.zero('BRL'), balanceAfter: brl('100.00') }),
        ),
      ).toThrow(InvalidAmountError);
    });

    it('recusa lançamento de valor negativo', () => {
      expect(() =>
        WalletLedgerEntry.create(
          state({ money: brl('80.00').negate(), balanceAfter: brl('180.00') }),
        ),
      ).toThrow(InvalidAmountError);
    });

    it('recusa saldo resultante negativo', () => {
      expect(() =>
        WalletLedgerEntry.create(
          state({
            money: brl('100.01'),
            balanceBefore: brl('100.00'),
            balanceAfter: brl('100.00').subtract(brl('100.01')),
          }),
        ),
      ).toThrow(UnbalancedLedgerEntryError);
    });

    it('recusa moeda divergente entre valor e saldos', () => {
      expect(() =>
        WalletLedgerEntry.create(
          state({ money: Money.from({ amount: '80.00', currency: 'USD' }) }),
        ),
      ).toThrow(UnbalancedLedgerEntryError);
    });
  });

  describe('reidratação', () => {
    it('reconstrói sem revalidar, para que a auditoria consiga ler o corrompido', () => {
      const corrompido = WalletLedgerEntry.rehydrate(
        state({ balanceAfter: brl('99.00') }),
      );

      expect(corrompido.balanceAfter.toString()).toBe('99.00');
      expect(corrompido.isBalanced()).toBe(false);
    });
  });

  describe('imutabilidade', () => {
    it('é estrutural, não convenção', () => {
      const entry = WalletLedgerEntry.create(state());

      expect(Object.isFrozen(entry)).toBe(true);
      expect(() => {
        (entry as unknown as { money: Money }).money = brl('1.00');
      }).toThrow(TypeError);
    });
  });
});
