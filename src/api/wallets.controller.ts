import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { OpenWallet } from '@/application/open-wallet.use-case';
import { ReconcileWallet } from '@/application/reconcile-wallet.use-case';
import { OpenWalletDto } from './dto/open-wallet.dto';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly openWallet: OpenWallet,
    private readonly reconcileWallet: ReconcileWallet,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: OpenWalletDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const result = await this.openWallet.execute({
      playerId: body.playerId,
      initialBalance: body.initialBalance.toMoney(),
      correlationId: correlationId ?? crypto.randomUUID(),
    });

    return {
      id: result.walletId,
      playerId: result.playerId,
      balance: result.balance.toJSON(),
      version: result.version,
    };
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcile(@Param('walletId', ParseUUIDPipe) walletId: string) {
    const result = await this.reconcileWallet.execute(walletId);

    return {
      walletId: result.walletId,
      storedBalance: result.storedBalance.toJSON(),
      calculatedBalance: result.calculatedBalance.toJSON(),
      difference: result.difference.toJSON(),
      consistent: result.consistent,
      checkedEntries: result.checkedEntries,
    };
  }
}
