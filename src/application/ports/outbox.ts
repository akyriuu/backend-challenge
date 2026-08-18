export interface PendingMessage {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
}

export interface OutboxStore {
  /**
   * Reclama um lote de mensagens devidas, entrega cada uma ao handler e registra
   * o desfecho — tudo numa transação. Mensagens já travadas por outro publisher
   * são puladas, não esperadas.
   */
  drain(
    batchSize: number,
    handler: (message: PendingMessage) => Promise<void>,
  ): Promise<number>;
}

export interface MessagePublisher {
  publish(message: PendingMessage): Promise<void>;
}

export const OUTBOX_STORE = Symbol('OUTBOX_STORE');
export const MESSAGE_PUBLISHER = Symbol('MESSAGE_PUBLISHER');
