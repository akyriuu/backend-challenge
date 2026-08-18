import { createHash } from 'node:crypto';
import { Money, type MoneyProps } from '@/domain/money';
import type { WagerTransactionKind } from '@/domain/wager-transaction';

export interface WagerTransactionPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;

  return Object.keys(source)
    .sort()
    .reduce<Record<string, unknown>>((canonical, key) => {
      if (source[key] !== undefined) {
        canonical[key] = canonicalize(source[key]);
      }

      return canonical;
    }, {});
};

export const payloadHashOf = (payload: WagerTransactionPayload): string => {
  const normalized: WagerTransactionPayload = {
    ...payload,
    money: Money.from(payload.money).toJSON(),
  };

  return createHash('sha256')
    .update(JSON.stringify(canonicalize(normalized)))
    .digest('hex');
};
