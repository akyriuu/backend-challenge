import { Controller, Get, Param } from '@nestjs/common';
import { TransactionNotFoundError } from '@/application/errors';
import { WageringQueries } from '@/infrastructure/database/queries/wagering-queries';

@Controller('providers/:providerId/wagering/transactions')
export class ProvidersController {
  constructor(private readonly queries: WageringQueries) {}

  @Get(':externalTransactionId')
  async findByProviderReference(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    const transaction = await this.queries.transactionByProviderReference(
      providerId,
      externalTransactionId,
    );

    if (!transaction) {
      throw new TransactionNotFoundError(
        `${providerId}:${externalTransactionId}`,
      );
    }

    return transaction;
  }
}
