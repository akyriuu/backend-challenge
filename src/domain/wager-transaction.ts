import { FailureCode } from './failure-code';
import {
  InvalidAmountError,
  InvalidReferenceError,
  InvalidTransactionStateError,
} from './errors';
import type { Money } from './money';
import { LedgerDirection } from './wallet-ledger-entry';

export const WagerTransactionKind = {
  OPENING: 'OPENING',
  BET: 'BET',
  WIN: 'WIN',
  LOSS: 'LOSS',
  REFUND: 'REFUND',
  ROLLBACK: 'ROLLBACK',
} as const;

export type WagerTransactionKind =
  (typeof WagerTransactionKind)[keyof typeof WagerTransactionKind];

export const WagerTransactionStatus = {
  PENDING: 'PENDING',
  PENDING_REFERENCE: 'PENDING_REFERENCE',
  PROCESSED: 'PROCESSED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;

export type WagerTransactionStatus =
  (typeof WagerTransactionStatus)[keyof typeof WagerTransactionStatus];

const TERMINAL_STATUSES: readonly WagerTransactionStatus[] = [
  WagerTransactionStatus.PROCESSED,
  WagerTransactionStatus.REJECTED,
  WagerTransactionStatus.FAILED,
];

const REVERSAL_KINDS: readonly WagerTransactionKind[] = [
  WagerTransactionKind.REFUND,
  WagerTransactionKind.ROLLBACK,
];

/** Regra 3 da seção 7: o que cada reversão pode referenciar. */
const REVERSIBLE_KINDS: Readonly<
  Record<'REFUND' | 'ROLLBACK', readonly WagerTransactionKind[]>
> = {
  REFUND: [WagerTransactionKind.BET],
  ROLLBACK: [
    WagerTransactionKind.BET,
    WagerTransactionKind.WIN,
    WagerTransactionKind.REFUND,
  ],
};

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

export class WagerTransaction {
  private constructor(
    readonly id: string,
    readonly providerId: string,
    readonly externalTransactionId: string,
    readonly idempotencyKey: string,
    readonly payloadHash: string,
    readonly walletId: string,
    readonly playerId: string,
    readonly roundId: string,
    readonly gameId: string,
    readonly kind: WagerTransactionKind,
    readonly money: Money,
    readonly referenceExternalTransactionId: string | undefined,
    readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  /** Entrada externa: nasce PENDING. OPENING é recusado por ser interno. */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.OPENING) {
      throw new InvalidReferenceError(
        'OPENING é interno e não pode ser submetido por API ou fila',
      );
    }

    return WagerTransaction.build(props);
  }

  /** Crédito de abertura de carteira: nasce já PROCESSED, sem referência. */
  static recordOpening(
    props: Omit<
      CreateWagerTransactionProps,
      'kind' | 'referenceExternalTransactionId'
    >,
  ): WagerTransaction {
    const transaction = WagerTransaction.build({
      ...props,
      kind: WagerTransactionKind.OPENING,
    });

    transaction.markProcessed(undefined, props.createdAt);

    return transaction;
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  private static build(props: CreateWagerTransactionProps): WagerTransaction {
    const transaction = WagerTransaction.rehydrate({
      ...props,
      status: WagerTransactionStatus.PENDING,
    });

    if (!props.money.isPositive()) {
      throw new InvalidAmountError(props.money.toString());
    }

    if (
      transaction.requiresReference() &&
      !props.referenceExternalTransactionId
    ) {
      throw new InvalidReferenceError(
        `${props.kind} exige referenceExternalTransactionId`,
      );
    }

    if (
      !transaction.requiresReference() &&
      props.referenceExternalTransactionId
    ) {
      throw new InvalidReferenceError(
        `${props.kind} não aceita referenceExternalTransactionId`,
      );
    }

    return transaction;
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  isTerminal(): boolean {
    return TERMINAL_STATUSES.includes(this._status);
  }

  isProcessed(): boolean {
    return this._status === WagerTransactionStatus.PROCESSED;
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.LOSS;
  }

  isReversal(): boolean {
    return REVERSAL_KINDS.includes(this.kind);
  }

  requiresReference(): boolean {
    return this.isReversal();
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /**
   * ROLLBACK inverte a direção da referência; os demais tipos têm direção fixa.
   * LOSS não produz lançamento, então perguntar sua direção é erro de programação.
   */
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    if (!this.affectsBalance()) {
      throw new InvalidTransactionStateError(this.kind, 'LEDGER_DIRECTION');
    }

    if (this.kind === WagerTransactionKind.BET) {
      return LedgerDirection.DEBIT;
    }

    if (this.kind !== WagerTransactionKind.ROLLBACK) {
      return LedgerDirection.CREDIT;
    }

    if (!reference) {
      throw new InvalidReferenceError(
        'ROLLBACK precisa da referência para determinar a direção',
      );
    }

    return reference.ledgerDirectionFor() === LedgerDirection.DEBIT
      ? LedgerDirection.CREDIT
      : LedgerDirection.DEBIT;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal(WagerTransactionStatus.PROCESSED);

    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._status = WagerTransactionStatus.PROCESSED;
  }

  markPendingReference(): void {
    this.assertNotTerminal(WagerTransactionStatus.PENDING_REFERENCE);

    this._status = WagerTransactionStatus.PENDING_REFERENCE;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal(WagerTransactionStatus.REJECTED);

    this._failureCode = code;
    this._status = WagerTransactionStatus.REJECTED;
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal(WagerTransactionStatus.FAILED);

    this._failureCode = code;
    this._status = WagerTransactionStatus.FAILED;
  }

  /** Regras 2, 3 e 5 da seção 7. Devolve o código de falha, ou undefined. */
  validateReference(reference: WagerTransaction): FailureCode | undefined {
    if (
      reference.providerId !== this.providerId ||
      reference.playerId !== this.playerId ||
      reference.walletId !== this.walletId ||
      reference.roundId !== this.roundId ||
      reference.money.currency !== this.money.currency
    ) {
      return FailureCode.REFERENCE_MISMATCH;
    }

    if (!reference.isProcessed()) {
      return FailureCode.REFERENCE_NOT_PROCESSED;
    }

    const permitidos =
      this.kind === WagerTransactionKind.REFUND
        ? REVERSIBLE_KINDS.REFUND
        : REVERSIBLE_KINDS.ROLLBACK;

    if (!permitidos.includes(reference.kind)) {
      return FailureCode.REFERENCE_NOT_REVERSIBLE;
    }

    if (!reference.money.equals(this.money)) {
      return FailureCode.AMOUNT_MISMATCH;
    }

    return undefined;
  }

  private assertNotTerminal(to: WagerTransactionStatus): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this._status, to);
    }
  }
}
