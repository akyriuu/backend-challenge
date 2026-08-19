import {
  Catch,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  ConnectionException,
  DeadlockException,
  DriverException,
  LockWaitTimeoutException,
} from '@mikro-orm/core';
import type { Response } from 'express';

/**
 * A seção 9 exige que a API distinga falha transitória de infraestrutura das
 * demais situações. Sem isto, um PostgreSQL indisponível vira 500 genérico e o
 * provedor não tem como saber se pode reenviar — que é a única informação que
 * ele precisa dessa resposta.
 */
@Catch(DriverException)
export class InfrastructureExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(InfrastructureExceptionFilter.name);

  catch(error: DriverException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const transitoria = this.isTransient(error);

    this.logger.error({
      message: 'falha de infraestrutura ao atender requisição',
      transitoria,
      reason: error.message,
    });

    if (transitoria) {
      response
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .header('Retry-After', '5')
        .json({
          error: 'ServiceUnavailable',
          message:
            'falha transitória de infraestrutura; a requisição pode ser reenviada',
        });

      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: 'InternalServerError',
      message: 'falha de infraestrutura não recuperável',
    });
  }

  /**
   * Conexão perdida, deadlock e espera de lock esgotada passam com o tempo.
   * Erro de sintaxe ou tabela inexistente é defeito de schema — reenviar só
   * repete a falha, e responder 503 convidaria o provedor a insistir à toa.
   */
  private isTransient(error: DriverException): boolean {
    return (
      error instanceof ConnectionException ||
      error instanceof DeadlockException ||
      error instanceof LockWaitTimeoutException
    );
  }
}
