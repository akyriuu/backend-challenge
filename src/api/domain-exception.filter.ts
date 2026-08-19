import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApplicationError,
  IdempotencyConflictError,
  InvalidCursorError,
  TransactionNotFoundError,
  WalletAlreadyExistsError,
  WalletNotFoundError,
} from '@/application/errors';
import { DomainError } from '@/domain/errors';

@Catch(DomainError, ApplicationError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(error: Error, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    response.status(this.statusFor(error)).json({
      error: error.name,
      message: error.message,
    });
  }

  /**
   * A seção 9 exige que a API distinga com clareza payload inválido, conflito,
   * rejeição de negócio e ausência de recurso. Com duas raízes de erro, o
   * mapeamento é `instanceof` — nunca inspeção de mensagem.
   */
  private statusFor(error: Error): number {
    if (
      error instanceof WalletNotFoundError ||
      error instanceof TransactionNotFoundError
    ) {
      return HttpStatus.NOT_FOUND;
    }

    if (error instanceof InvalidCursorError) {
      return HttpStatus.BAD_REQUEST;
    }

    if (
      error instanceof IdempotencyConflictError ||
      error instanceof WalletAlreadyExistsError
    ) {
      return HttpStatus.CONFLICT;
    }

    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
}
