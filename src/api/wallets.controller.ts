import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { OpenWallet } from '@/application/open-wallet.use-case';
import { ReconcileWallet } from '@/application/reconcile-wallet.use-case';
import { WalletNotFoundError } from '@/application/errors';
import { WageringQueries } from '@/infrastructure/database/queries/wagering-queries';
import { OpenWalletDto } from './dto/open-wallet.dto';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly openWallet: OpenWallet,
    private readonly reconcileWallet: ReconcileWallet,
    private readonly queries: WageringQueries,
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

  @Get(':walletId')
  async findOne(@Param('walletId', ParseUUIDPipe) walletId: string) {
    const wallet = await this.queries.wallet(walletId);

    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    return wallet;
  }

  @Get(':walletId/ledger')
  async ledger(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    const wallet = await this.queries.wallet(walletId);

    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    return this.queries.ledger(walletId, { cursor, limit });
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
