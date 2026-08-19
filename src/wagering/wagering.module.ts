import { Module } from '@nestjs/common';
import { OpenWallet } from '@/application/open-wallet.use-case';
import { ProcessWagerTransaction } from '@/application/process-wager-transaction-use-case';
import { ReconcileWallet } from '@/application/reconcile-wallet.use-case';
import { CLOCK, ID_GENERATOR } from '@/application/ports/system';
import { UNIT_OF_WORK } from '@/application/ports/unit-of-work';
import { ProvidersController } from '@/api/providers.controller';
import { WageringController } from '@/api/wagering.controller';
import { WalletsController } from '@/api/wallets.controller';
import { ProviderAuthGuard } from '@/api/auth/provider-auth.guard';
import {
  PROVIDER_IDENTITY_RESOLVER,
  TrustedPayloadIdentityResolver,
} from '@/api/auth/provider-identity';
import { WageringQueries } from '@/infrastructure/database/queries/wagering-queries';
import { MikroOrmUnitOfWork } from '@/infrastructure/database/mikro-orm.unit-of-work';
import { SystemClock } from '@/infrastructure/system/system-clock';
import { UuidV7Generator } from '@/infrastructure/system/uuid-v7.generator';

@Module({
  controllers: [WalletsController, WageringController, ProvidersController],
  providers: [
    ProcessWagerTransaction,
    OpenWallet,
    ReconcileWallet,
    WageringQueries,
    ProviderAuthGuard,
    {
      provide: PROVIDER_IDENTITY_RESOLVER,
      useClass: TrustedPayloadIdentityResolver,
    },
    { provide: UNIT_OF_WORK, useClass: MikroOrmUnitOfWork },
    { provide: ID_GENERATOR, useClass: UuidV7Generator },
    { provide: CLOCK, useClass: SystemClock },
  ],
  /**
   * Os três tokens saem daqui porque outros módulos montam casos de uso sobre a
   * mesma unidade de trabalho — o worker de referências pendentes, por exemplo.
   * Sem exportá-los, o Nest falha no boot com erro de dependência.
   */
  exports: [
    ProcessWagerTransaction,
    OpenWallet,
    ReconcileWallet,
    UNIT_OF_WORK,
    ID_GENERATOR,
    CLOCK,
  ],
})
export class WageringModule {}
