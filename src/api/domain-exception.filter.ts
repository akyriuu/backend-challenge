import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  IdempotencyConflictError,
  WalletAlreadyExistsError,
  WalletNotFoundError,
} from '@/application/errors';
import { DomainError } from '@/domain/errors';

@Catch(
  DomainError,
  WalletNotFoundError,
  IdempotencyConflictError,
  WalletAlreadyExistsError,
)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(error: Error, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    response.status(this.statusFor(error)).json({
      error: error.name,
      message: error.message,
    });
  }

  private statusFor(error: Error): number {
    if (error instanceof WalletNotFoundError) {
      return HttpStatus.NOT_FOUND;
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
