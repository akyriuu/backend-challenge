import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import config from './infrastructure/database/mikro-orm.config';
import { HealthModule } from './health/health.module';
import { ObservabilityModule } from './observability/observability.module';
import { WageringModule } from './wagering/wagering.module';
import { OutboxModule } from './messaging/outbox.module';
import { ConsumerModule } from './messaging/consumer.module';
import { PendingReferenceModule } from './messaging/pending-reference.module';

@Module({
  imports: [
    MikroOrmModule.forRoot(config),
    ObservabilityModule,
    HealthModule,
    WageringModule,
    OutboxModule,
    ConsumerModule,
    PendingReferenceModule,
  ],
})
export class AppModule {}
