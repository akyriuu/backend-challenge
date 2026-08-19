import { Controller, Get, Header, Inject } from '@nestjs/common';
import { METRICS, type Metrics } from '@/application/ports/metrics';
import { OUTBOX_STORE, type OutboxStore } from '@/application/ports/outbox';

@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(OUTBOX_STORE) private readonly outbox: OutboxStore,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async scrape(): Promise<string> {
    /** Lag é medido na raspagem: contador acumulado não descreveria atraso atual. */
    this.metrics.setGauge(
      'wager_outbox_lag_seconds',
      await this.outbox.oldestPendingAgeSeconds(),
    );

    return this.metrics.render();
  }
}
