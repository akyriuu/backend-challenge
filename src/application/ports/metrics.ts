export type MetricLabels = Record<string, string>;

export interface Metrics {
  increment(name: string, labels?: MetricLabels, by?: number): void;
  observe(name: string, seconds: number, labels?: MetricLabels): void;
  setGauge(name: string, value: number, labels?: MetricLabels): void;
  render(): string;
}

export const METRICS = Symbol('METRICS');

/**
 * Instrumentação nunca pode ser dependência dura da regra de negócio: o caso de
 * uso recebe este padrão quando ninguém injeta métricas, e os testes continuam
 * podendo construí-lo com três argumentos.
 */
export const noopMetrics: Metrics = {
  increment: () => undefined,
  observe: () => undefined,
  setGauge: () => undefined,
  render: () => '',
};
