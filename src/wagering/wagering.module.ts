import { Module } from '@nestjs/common';
import { OpenWallet } from '@/application/open-wallet.use-case';
import { ProcessWagerTransaction } from '@/application/process-wager-transaction-use-case';
import { CLOCK, ID_GENERATOR } from '@/application/ports/system';
import { UNIT_OF_WORK } from '@/application/ports/unit-of-work';
import { WageringController } from '@/api/wagering.controller';
import { WalletsController } from '@/api/wallets.controller';
import { MikroOrmUnitOfWork } from '@/infrastructure/database/mikro-orm.unit-of-work';
import { SystemClock } from '@/infrastructure/system/system-clock';
import { UuidV7Generator } from '@/infrastructure/system/uuid-v7.generator';
import { ReconcileWallet } from '@/application/reconcile-wallet.use-case';

@Module({
  controllers: [WalletsController, WageringController],
  providers: [
    ProcessWagerTransaction,
    OpenWallet,
    ReconcileWallet,
    { provide: UNIT_OF_WORK, useClass: MikroOrmUnitOfWork },
    { provide: ID_GENERATOR, useClass: UuidV7Generator },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [ProcessWagerTransaction, OpenWallet, ReconcileWallet],
})
export class WageringModule {}
