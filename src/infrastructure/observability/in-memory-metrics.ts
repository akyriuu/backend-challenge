import { Injectable } from '@nestjs/common';
import type { MetricLabels, Metrics } from '@/application/ports/metrics';

const seriesKey = (name: string, labels: MetricLabels): string => {
  const pairs = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${value}"`);

  return pairs.length > 0 ? `${name}{${pairs.join(',')}}` : name;
};

const familyOf = (key: string): string => key.split('{')[0] ?? key;

@Injectable()
export class InMemoryMetrics implements Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly summaries = new Map<
    string,
    { count: number; sum: number }
  >();

  increment(name: string, labels: MetricLabels = {}, by = 1): void {
    const key = seriesKey(name, labels);

    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  observe(name: string, seconds: number, labels: MetricLabels = {}): void {
    const key = seriesKey(name, labels);
    const current = this.summaries.get(key) ?? { count: 0, sum: 0 };

    this.summaries.set(key, {
      count: current.count + 1,
      sum: current.sum + seconds,
    });
  }

  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    this.gauges.set(seriesKey(name, labels), value);
  }

  /** Formato de exposição do Prometheus, sem dependência de biblioteca. */
  render(): string {
    const lines: string[] = [];
    const declared = new Set<string>();

    const declare = (key: string, type: string): void => {
      const family = familyOf(key);

      if (!declared.has(family)) {
        declared.add(family);
        lines.push(`# TYPE ${family} ${type}`);
      }
    };

    for (const [key, value] of this.counters) {
      declare(key, 'counter');
      lines.push(`${key} ${value}`);
    }

    for (const [key, value] of this.gauges) {
      declare(key, 'gauge');
      lines.push(`${key} ${value}`);
    }

    for (const [key, value] of this.summaries) {
      declare(key, 'summary');
      const family = familyOf(key);
      const labels = key.slice(family.length);

      lines.push(`${family}_count${labels} ${value.count}`);
      lines.push(`${family}_sum${labels} ${value.sum}`);
    }

    return `${lines.join('\n')}\n`;
  }
}
