import { Global, Module } from '@nestjs/common';
import { METRICS } from '@/application/ports/metrics';
import { InMemoryMetrics } from '@/infrastructure/observability/in-memory-metrics';

/**
 * Global porque métricas são transversais: exigir importação em cada módulo
 * transformaria instrumentação numa negociação de dependências.
 */
@Global()
@Module({
  providers: [{ provide: METRICS, useClass: InMemoryMetrics }],
  exports: [METRICS],
})
export class ObservabilityModule {}
