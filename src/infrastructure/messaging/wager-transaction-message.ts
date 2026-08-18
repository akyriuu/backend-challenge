import { Money } from '@/domain/money';
import {
  WagerTransactionKind,
  type WagerTransactionKind as Kind,
} from '@/domain/wager-transaction';
export class MalformedMessageError extends Error {
  constructor(reason: string) {
    super(`mensagem malformada: ${reason}`);
    this.name = 'MalformedMessageError';
  }
}
export interface WagerTransactionMessage {
  messageId: string;
  type: string;
  occurredAt: string;
  data: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: Kind;
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
  };
}
const SUBMITTABLE_KINDS: readonly Kind[] = [
  WagerTransactionKind.BET,
  WagerTransactionKind.WIN,
  WagerTransactionKind.LOSS,
  WagerTransactionKind.REFUND,
  WagerTransactionKind.ROLLBACK,
];
const text = (source: Record<string, unknown>, field: string): string => {
  const value = source[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedMessageError(`campo "${field}" ausente ou inválido`);
  }
  return value;
};
const optionalText = (
  source: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = source[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new MalformedMessageError(`campo "${field}" inválido`);
  }
  return value;
};
const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedMessageError(`"${label}" não é um objeto`);
  }
  return value as Record<string, unknown>;
};
/**
 * A validação monetária acontece aqui, e a exceção do domínio é convertida em
 * erro de transporte. Sem essa conversão, um valor com três casas decimais
 * escaparia como erro desconhecido e seria tratado como falha transitória —
 * cinco reentregas para um defeito que nenhuma retentativa conserta.
 */
const assertMoney = (amount: string, currency: string): void => {
  try {
    Money.from({ amount, currency });
  } catch {
    throw new MalformedMessageError(
      `valor monetário inválido: "${amount}" ${currency}`,
    );
  }
};
/**
 * Falha aqui é permanente: nenhuma quantidade de retentativas conserta um corpo
 * inválido, então quem chama manda direto para a DLQ.
 */
export const parseWagerTransactionMessage = (
  body: string,
): WagerTransactionMessage => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new MalformedMessageError('corpo não é JSON válido');
  }
  const envelope = asRecord(parsed, 'envelope');
  const data = asRecord(envelope.data, 'data');
  const money = asRecord(data.money, 'data.money');
  const kind = text(data, 'kind') as Kind;
  if (!SUBMITTABLE_KINDS.includes(kind)) {
    throw new MalformedMessageError(`kind "${kind}" não pode ser submetido`);
  }
  const amount = text(money, 'amount');
  const currency = text(money, 'currency');
  assertMoney(amount, currency);
  return {
    messageId: text(envelope, 'messageId'),
    type: text(envelope, 'type'),
    occurredAt: text(envelope, 'occurredAt'),
    data: {
      providerId: text(data, 'providerId'),
      externalTransactionId: text(data, 'externalTransactionId'),
      idempotencyKey: text(data, 'idempotencyKey'),
      playerId: text(data, 'playerId'),
      walletId: text(data, 'walletId'),
      roundId: text(data, 'roundId'),
      gameId: text(data, 'gameId'),
      kind,
      money: { amount, currency },
      referenceExternalTransactionId: optionalText(
        data,
        'referenceExternalTransactionId',
      ),
    },
  };
};
