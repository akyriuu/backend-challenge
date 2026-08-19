import { Module } from '@nestjs/common';
import { ResolvePendingReference } from '@/application/resolve-pending-reference.use-case';
import { PENDING_REFERENCE_STORE } from '@/application/ports/pending-reference';
import { MikroOrmPendingReferenceStore } from '@/infrastructure/database/mikro-orm.pending-reference-store';
import { PendingReferenceWorker } from '@/infrastructure/messaging/pending-reference.worker';
import { WageringModule } from '@/wagering/wagering.module';

@Module({
  imports: [WageringModule],
  providers: [
    ResolvePendingReference,
    PendingReferenceWorker,
    {
      provide: PENDING_REFERENCE_STORE,
      useClass: MikroOrmPendingReferenceStore,
    },
  ],
})
export class PendingReferenceModule {}
