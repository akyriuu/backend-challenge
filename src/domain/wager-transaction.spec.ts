import { describe, expect, it } from 'bun:test';
import {
  InvalidAmountError,
  InvalidReferenceError,
  InvalidTransactionStateError,
} from './errors';
import { FailureCode } from './failure-code';
import { Money } from './money';
import { LedgerDirection } from './wallet-ledger-entry';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type CreateWagerTransactionProps,
} from './wager-transaction';

const CREATED_AT = new Date('2026-08-18T12:00:00.000Z');
const PROCESSED_AT = new Date('2026-08-18T12:00:01.000Z');

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

const props = (
  overrides: Partial<CreateWagerTransactionProps> = {},
): CreateWagerTransactionProps => ({
  id: '018f0e3a-0000-7000-8000-000000000001',
  providerId: 'provider-a',
  externalTransactionId: 'transaction-123',
  idempotencyKey: 'provider-a:transaction-123',
  payloadHash: 'hash-1',
  walletId: '018f0e3a-0000-7000-8000-000000000002',
  playerId: '018f0e3a-0000-7000-8000-000000000003',
  roundId: 'round-987',
  gameId: 'fortune-chimp',
  kind: WagerTransactionKind.BET,
  money: brl('80.00'),
  createdAt: CREATED_AT,
  ...overrides,
});

const processada = (
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction => {
  const transaction = WagerTransaction.create(props(overrides));
  transaction.markProcessed(undefined, PROCESSED_AT);

  return transaction;
};

const reversao = (
  kind:
    typeof WagerTransactionKind.REFUND | typeof WagerTransactionKind.ROLLBACK,
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction =>
  WagerTransaction.create(
    props({
      id: '018f0e3a-0000-7000-8000-0000000000aa',
      externalTransactionId: 'transaction-456',
      idempotencyKey: 'provider-a:transaction-456',
      kind,
      referenceExternalTransactionId: 'transaction-123',
      ...overrides,
    }),
  );

describe('WagerTransaction', () => {
  describe('criação', () => {
    it('nasce PENDING', () => {
      expect(WagerTransaction.create(props()).status).toBe(
        WagerTransactionStatus.PENDING,
      );
    });

    it('recusa OPENING vindo de fora', () => {
      expect(() =>
        WagerTransaction.create(props({ kind: WagerTransactionKind.OPENING })),
      ).toThrow(InvalidReferenceError);
    });

    it('cria OPENING pela via interna, já processada', () => {
      const opening = WagerTransaction.recordOpening(
        props({ money: brl('1000.00') }),
      );

      expect(opening.kind).toBe(WagerTransactionKind.OPENING);
      expect(opening.status).toBe(WagerTransactionStatus.PROCESSED);
      expect(opening.processedAt).toBe(CREATED_AT);
    });

    it('exige referência para REFUND e ROLLBACK', () => {
      for (const kind of [
        WagerTransactionKind.REFUND,
        WagerTransactionKind.ROLLBACK,
      ]) {
        expect(() => WagerTransaction.create(props({ kind }))).toThrow(
          InvalidReferenceError,
        );
      }
    });

    it('recusa referência em tipos que não a admitem', () => {
      expect(() =>
        WagerTransaction.create(
          props({ referenceExternalTransactionId: 'transaction-123' }),
        ),
      ).toThrow(InvalidReferenceError);
    });

    it('recusa valor não positivo', () => {
      expect(() =>
        WagerTransaction.create(props({ money: Money.zero('BRL') })),
      ).toThrow(InvalidAmountError);
    });
  });

  describe('consultas de domínio', () => {
    it('LOSS não afeta saldo; os demais afetam', () => {
      expect(
        WagerTransaction.create(
          props({ kind: WagerTransactionKind.LOSS }),
        ).affectsBalance(),
      ).toBe(false);
      expect(WagerTransaction.create(props()).affectsBalance()).toBe(true);
    });

    it('compara o hash do payload para distinguir replay de conflito', () => {
      const transaction = WagerTransaction.create(props());

      expect(transaction.matchesPayload('hash-1')).toBe(true);
      expect(transaction.matchesPayload('hash-2')).toBe(false);
    });
  });

  describe('direção do lançamento', () => {
    it('BET debita e WIN credita', () => {
      expect(WagerTransaction.create(props()).ledgerDirectionFor()).toBe(
        LedgerDirection.DEBIT,
      );
      expect(
        WagerTransaction.create(
          props({ kind: WagerTransactionKind.WIN }),
        ).ledgerDirectionFor(),
      ).toBe(LedgerDirection.CREDIT);
    });

    it('REFUND credita', () => {
      expect(reversao(WagerTransactionKind.REFUND).ledgerDirectionFor()).toBe(
        LedgerDirection.CREDIT,
      );
    });

    it('ROLLBACK inverte a direção da referência', () => {
      const rollbackDeBet = reversao(WagerTransactionKind.ROLLBACK);
      const rollbackDeWin = reversao(WagerTransactionKind.ROLLBACK);

      expect(rollbackDeBet.ledgerDirectionFor(processada())).toBe(
        LedgerDirection.CREDIT,
      );
      expect(
        rollbackDeWin.ledgerDirectionFor(
          processada({ kind: WagerTransactionKind.WIN }),
        ),
      ).toBe(LedgerDirection.DEBIT);
    });

    it('ROLLBACK sem referência não tem direção definida', () => {
      expect(() =>
        reversao(WagerTransactionKind.ROLLBACK).ledgerDirectionFor(),
      ).toThrow(InvalidReferenceError);
    });

    it('perguntar a direção de um LOSS é erro de programação', () => {
      expect(() =>
        WagerTransaction.create(
          props({ kind: WagerTransactionKind.LOSS }),
        ).ledgerDirectionFor(),
      ).toThrow(InvalidTransactionStateError);
    });
  });

  describe('transições', () => {
    it('vai de PENDING a PROCESSED registrando referência e instante', () => {
      const transaction = WagerTransaction.create(props());

      transaction.markProcessed('ref-interno', PROCESSED_AT);

      expect(transaction.status).toBe(WagerTransactionStatus.PROCESSED);
      expect(transaction.referenceTransactionId).toBe('ref-interno');
      expect(transaction.processedAt).toBe(PROCESSED_AT);
      expect(transaction.isTerminal()).toBe(true);
    });

    it('aguarda a referência e conclui depois', () => {
      const reversal = reversao(WagerTransactionKind.REFUND);

      reversal.markPendingReference();
      expect(reversal.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);
      expect(reversal.isTerminal()).toBe(false);

      reversal.markProcessed('ref-interno', PROCESSED_AT);
      expect(reversal.status).toBe(WagerTransactionStatus.PROCESSED);
    });

    it('rejeita com código de falha', () => {
      const transaction = WagerTransaction.create(props());

      transaction.reject(FailureCode.INSUFFICIENT_FUNDS);

      expect(transaction.status).toBe(WagerTransactionStatus.REJECTED);
      expect(transaction.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
      expect(transaction.isTerminal()).toBe(true);
    });

    it('estados terminais não transicionam', () => {
      for (const terminar of [
        (t: WagerTransaction) => t.markProcessed(undefined, PROCESSED_AT),
        (t: WagerTransaction) => t.reject(FailureCode.INSUFFICIENT_FUNDS),
        (t: WagerTransaction) => t.fail(FailureCode.PERSISTENCE_FAILURE),
      ]) {
        const transaction = WagerTransaction.create(props());
        terminar(transaction);

        expect(() =>
          transaction.markProcessed(undefined, PROCESSED_AT),
        ).toThrow(InvalidTransactionStateError);
        expect(() => transaction.markPendingReference()).toThrow(
          InvalidTransactionStateError,
        );
        expect(() => transaction.reject(FailureCode.AMOUNT_MISMATCH)).toThrow(
          InvalidTransactionStateError,
        );
      }
    });
  });

  describe('validação da referência', () => {
    it('aceita REFUND de BET equivalente', () => {
      expect(
        reversao(WagerTransactionKind.REFUND).validateReference(processada()),
      ).toBeUndefined();
    });

    it('recusa REFUND de algo que não é BET', () => {
      expect(
        reversao(WagerTransactionKind.REFUND).validateReference(
          processada({ kind: WagerTransactionKind.WIN }),
        ),
      ).toBe(FailureCode.REFERENCE_NOT_REVERSIBLE);
    });

    it('aceita ROLLBACK de BET, WIN e REFUND', () => {
      for (const kind of [WagerTransactionKind.BET, WagerTransactionKind.WIN]) {
        expect(
          reversao(WagerTransactionKind.ROLLBACK).validateReference(
            processada({ kind }),
          ),
        ).toBeUndefined();
      }
    });

    it('recusa referência de outro provedor, jogador, carteira ou rodada', () => {
      const reversal = reversao(WagerTransactionKind.ROLLBACK);

      expect(
        reversal.validateReference(processada({ providerId: 'provider-b' })),
      ).toBe(FailureCode.REFERENCE_MISMATCH);
      expect(
        reversal.validateReference(processada({ roundId: 'round-000' })),
      ).toBe(FailureCode.REFERENCE_MISMATCH);
    });

    it('recusa referência ainda não processada', () => {
      expect(
        reversao(WagerTransactionKind.REFUND).validateReference(
          WagerTransaction.create(props()),
        ),
      ).toBe(FailureCode.REFERENCE_NOT_PROCESSED);
    });

    it('exige reversão integral', () => {
      expect(
        reversao(WagerTransactionKind.REFUND, {
          money: brl('79.99'),
        }).validateReference(processada()),
      ).toBe(FailureCode.AMOUNT_MISMATCH);
    });
  });
});
