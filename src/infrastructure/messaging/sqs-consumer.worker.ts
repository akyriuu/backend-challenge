import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { IdempotencyConflictError } from '@/application/errors';
import { ProcessWagerTransaction } from '@/application/process-wager-transaction-use-case';
import { payloadHashOf } from '@/application/payload-hash';
import { Money } from '@/domain/money';
import { env } from '@/config/env';
import {
  MalformedMessageError,
  parseWagerTransactionMessage,
  type WagerTransactionMessage,
} from './wager-transaction-message';
@Injectable()
export class SqsConsumerWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SqsConsumerWorker.name);
  private stopping = false;
  private cycle: Promise<void> = Promise.resolve();
  constructor(
    private readonly client: SQSClient,
    private readonly process: ProcessWagerTransaction,
  ) {}
  onApplicationBootstrap(): void {
    if (!env.consumer.enabled) {
      this.logger.warn({ message: 'consumidor desabilitado por configuração' });
      return;
    }
    this.loop();
  }
  /** Conclui o ciclo em andamento: nenhuma mensagem fica sem ack nem sem rollback. */
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.cycle;
  }
  async pollOnce(): Promise<void> {
    try {
      const response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: env.sqs.queueUrl,
          MaxNumberOfMessages: env.consumer.batchSize,
          WaitTimeSeconds: env.consumer.waitTimeSeconds,
          MessageAttributeNames: ['All'],
        }),
      );
      for (const message of response.Messages ?? []) {
        if (this.stopping) {
          /** Deixa a visibilidade expirar em vez de processar durante o encerramento. */
          return;
        }
        await this.handle(message);
      }
    } catch (error) {
      this.logger.error({
        message: 'ciclo do consumidor falhou',
        reason: error instanceof Error ? error.message : 'desconhecido',
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  private loop(): void {
    if (this.stopping) {
      return;
    }
    this.cycle = this.pollOnce().finally(() => this.loop());
  }
  private async handle(message: Message): Promise<void> {
    let parsed: WagerTransactionMessage;
    try {
      parsed = parseWagerTransactionMessage(message.Body ?? '');
    } catch (error) {
      if (error instanceof MalformedMessageError) {
        await this.moveToDlq(message, error.message);
        return;
      }
      throw error;
    }
    try {
      const result = await this.process.execute({
        providerId: parsed.data.providerId,
        externalTransactionId: parsed.data.externalTransactionId,
        idempotencyKey: parsed.data.idempotencyKey,
        payloadHash: payloadHashOf({
          providerId: parsed.data.providerId,
          externalTransactionId: parsed.data.externalTransactionId,
          playerId: parsed.data.playerId,
          walletId: parsed.data.walletId,
          roundId: parsed.data.roundId,
          gameId: parsed.data.gameId,
          kind: parsed.data.kind,
          money: parsed.data.money,
          referenceExternalTransactionId:
            parsed.data.referenceExternalTransactionId,
        }),
        walletId: parsed.data.walletId,
        playerId: parsed.data.playerId,
        roundId: parsed.data.roundId,
        gameId: parsed.data.gameId,
        kind: parsed.data.kind,
        money: Money.from(parsed.data.money),
        referenceExternalTransactionId:
          parsed.data.referenceExternalTransactionId,
        inbox: {
          consumerName: env.consumer.name,
          messageId: parsed.messageId,
        },
        correlationId: parsed.messageId,
      });
      /** Ack somente depois do commit: se o processo morrer antes, há reentrega. */
      await this.acknowledge(message);
      this.logger.log({
        message: 'mensagem processada',
        messageId: parsed.messageId,
        transactionId: result.transactionId,
        walletId: parsed.data.walletId,
        providerId: parsed.data.providerId,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        /** Permanente: a mesma chave com outro payload nunca vai ser aceita. */
        await this.moveToDlq(message, error.message);
        return;
      }
      /**
       * Transitório: sem ack, o SQS reentrega ao expirar a visibilidade e a
       * política de redrive manda para a DLQ ao esgotar maxReceiveCount.
       */
      this.logger.warn({
        message: 'falha transitória, mensagem será reentregue',
        messageId: parsed.messageId,
        walletId: parsed.data.walletId,
        reason: error instanceof Error ? error.message : 'desconhecido',
      });
    }
  }
  private async moveToDlq(message: Message, reason: string): Promise<void> {
    const messageId = message.MessageId ?? Bun.randomUUIDv7();
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: env.sqs.dlqUrl,
        MessageBody: message.Body ?? '',
        /**
         * Um grupo por mensagem. Numa DLQ não há ordem a preservar, e um grupo
         * único faria a primeira mensagem em voo bloquear a inspeção de todas
         * as outras — bloqueio de cabeça de fila.
         */
        MessageGroupId: messageId,
        MessageDeduplicationId: messageId,
      }),
    );
    /** O envio precede o ack: invertido, morrer no meio faria a mensagem sumir. */
    await this.acknowledge(message);
    this.logger.error({
      message: 'mensagem enviada para a DLQ',
      messageId,
      reason,
    });
  }
  private async acknowledge(message: Message): Promise<void> {
    if (!message.ReceiptHandle) {
      return;
    }
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: env.sqs.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }
}
