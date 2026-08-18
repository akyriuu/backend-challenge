import { describe, expect, it } from 'bun:test';
import { WagerTransactionKind } from '@/domain/wager-transaction';
import { payloadHashOf, type WagerTransactionPayload } from './payload-hash';

const payload = (
  overrides: Partial<WagerTransactionPayload> = {},
): WagerTransactionPayload => ({
  providerId: 'provider-a',
  externalTransactionId: 'transaction-123',
  playerId: '018f0e3a-0000-7000-8000-000000000002',
  walletId: '018f0e3a-0000-7000-8000-000000000001',
  roundId: 'round-987',
  gameId: 'fortune-chimp',
  kind: WagerTransactionKind.BET,
  money: { amount: '25.00', currency: 'BRL' },
  ...overrides,
});

describe('payloadHashOf', () => {
  it('não depende da ordem das chaves', () => {
    const direto = payloadHashOf(payload());
    const invertido = payloadHashOf(
      Object.fromEntries(
        Object.entries(payload()).reverse(),
      ) as WagerTransactionPayload,
    );

    expect(invertido).toBe(direto);
  });

  it('trata escalas equivalentes como o mesmo payload', () => {
    expect(
      payloadHashOf(payload({ money: { amount: '25.0', currency: 'BRL' } })),
    ).toBe(
      payloadHashOf(payload({ money: { amount: '25.00', currency: 'BRL' } })),
    );
  });

  it('trata campo opcional ausente e indefinido como iguais', () => {
    expect(
      payloadHashOf(payload({ referenceExternalTransactionId: undefined })),
    ).toBe(payloadHashOf(payload()));
  });

  it('muda quando qualquer campo de negócio muda', () => {
    const base = payloadHashOf(payload());

    expect(
      payloadHashOf(payload({ money: { amount: '25.01', currency: 'BRL' } })),
    ).not.toBe(base);
    expect(payloadHashOf(payload({ kind: WagerTransactionKind.WIN }))).not.toBe(
      base,
    );
    expect(payloadHashOf(payload({ roundId: 'round-988' }))).not.toBe(base);
    expect(payloadHashOf(payload({ walletId: 'outra' }))).not.toBe(base);
  });
});
