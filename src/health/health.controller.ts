import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HEALTH_PROBES, type HealthProbe } from './health-probe';

const PROBE_TIMEOUT_MS = 2_000;

interface ProbeResult {
  name: string;
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_PROBES) private readonly probes: HealthProbe[]) {}

  @Get('live')
  live(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Get('ready')
  async ready(): Promise<{ status: string; checks: ProbeResult[] }> {
    const checks = await Promise.all(
      this.probes.map((probe) => this.run(probe)),
    );
    const body = {
      status: checks.every((check) => check.status === 'up')
        ? 'ok'
        : 'degraded',
      checks,
    };

    if (body.status !== 'ok') {
      throw new ServiceUnavailableException(body);
    }

    return body;
  }

  private async run(probe: HealthProbe): Promise<ProbeResult> {
    const startedAt = performance.now();

    try {
      await Promise.race([
        probe.check(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS),
        ),
      ]);

      return {
        name: probe.name,
        status: 'up',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      return {
        name: probe.name,
        status: 'down',
        latencyMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : 'erro desconhecido',
      };
    }
  }
}
