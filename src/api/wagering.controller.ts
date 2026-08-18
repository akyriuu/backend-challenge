import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProcessWagerTransaction } from '@/application/process-wager-transaction-use-case';
import { payloadHashOf } from '@/application/payload-hash';
import { WagerTransactionStatus } from '@/domain/wager-transaction';
import { SubmitWagerTransactionDto } from './dto/submit-wager-transaction.dto';

@Controller('wagering/transactions')
export class WageringController {
  constructor(private readonly process: ProcessWagerTransaction) {}

  @Post()
  async submit(
    @Body() body: SubmitWagerTransactionDto,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('header Idempotency-Key é obrigatório');
    }

    const result = await this.process.execute({
      providerId: body.providerId,
      externalTransactionId: body.externalTransactionId,
      idempotencyKey,
      payloadHash: payloadHashOf({
        providerId: body.providerId,
        externalTransactionId: body.externalTransactionId,
        playerId: body.playerId,
        walletId: body.walletId,
        roundId: body.roundId,
        gameId: body.gameId,
        kind: body.kind,
        money: { amount: body.money.amount, currency: body.money.currency },
        referenceExternalTransactionId: body.referenceExternalTransactionId,
      }),
      walletId: body.walletId,
      playerId: body.playerId,
      roundId: body.roundId,
      gameId: body.gameId,
      kind: body.kind,
      money: body.money.toMoney(),
      referenceExternalTransactionId: body.referenceExternalTransactionId,
      correlationId: correlationId ?? crypto.randomUUID(),
    });

    response.status(this.statusFor(result.status));

    return {
      transactionId: result.transactionId,
      status: result.status,
      balance: result.balance.toJSON(),
      failureCode: result.failureCode,
      idempotentReplay: result.idempotentReplay,
    };
  }

  private statusFor(status: WagerTransactionStatus): number {
    if (status === WagerTransactionStatus.REJECTED) {
      return HttpStatus.UNPROCESSABLE_ENTITY;
    }

    if (status === WagerTransactionStatus.PENDING_REFERENCE) {
      return HttpStatus.ACCEPTED;
    }

    return HttpStatus.OK;
  }
}
