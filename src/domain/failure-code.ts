/**
 * Códigos estáveis, legíveis por máquina. Agrupados pela decisão que o provedor
 * precisa tomar ao recebê-los.
 */
export const FailureCode = {
  /** Regra de negócio: reenviar não resolve. */
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  REVERSAL_WOULD_OVERDRAW: 'REVERSAL_WOULD_OVERDRAW',
  REFERENCE_NOT_FOUND: 'REFERENCE_NOT_FOUND',
  REFERENCE_MISMATCH: 'REFERENCE_MISMATCH',
  REFERENCE_NOT_PROCESSED: 'REFERENCE_NOT_PROCESSED',
  REFERENCE_NOT_REVERSIBLE: 'REFERENCE_NOT_REVERSIBLE',
  REFERENCE_ALREADY_REVERSED: 'REFERENCE_ALREADY_REVERSED',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',

  /** Payload inválido: corrigir e reenviar resolve. */
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
  KIND_NOT_ALLOWED: 'KIND_NOT_ALLOWED',

  /** Infraestrutura permanente: auditável, não reprocessável automaticamente. */
  PERSISTENCE_FAILURE: 'PERSISTENCE_FAILURE',
} as const;

export type FailureCode = (typeof FailureCode)[keyof typeof FailureCode];
