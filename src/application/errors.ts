export abstract class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class WalletNotFoundError extends ApplicationError {
  constructor(readonly walletId: string) {
    super(`carteira não encontrada: ${walletId}`);
  }
}

export class WalletAlreadyExistsError extends ApplicationError {
  constructor(
    readonly playerId: string,
    readonly currency: string,
  ) {
    super(`carteira já existe para ${playerId} em ${currency}`);
  }
}

export class TransactionNotFoundError extends ApplicationError {
  constructor(readonly reference: string) {
    super(`transação não encontrada: ${reference}`);
  }
}

export class IdempotencyConflictError extends ApplicationError {
  constructor(readonly idempotencyKey: string) {
    super(
      `chave de idempotência reutilizada com payload diferente: ${idempotencyKey}`,
    );
  }
}

export class InvalidCursorError extends ApplicationError {
  constructor(readonly cursor: string) {
    super(`cursor de paginação inválido: ${cursor}`);
  }
}

export class UnsupportedTransactionKindError extends ApplicationError {
  constructor(readonly kind: string) {
    super(`tipo de transação não suportado neste fluxo: ${kind}`);
  }
}
