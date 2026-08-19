const required = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Varíavel de ambiente obrigatória não encontrada: ${name}`);
  }

  return value;
};

const optional = (name: string): string | undefined =>
  process.env[name] || undefined;

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  sqs: {
    region: required('AWS_REGION'),
    endpoint: optional('SQS_ENDPOINT'),
    queueUrl: required('SQS_QUEUE_URL'),
    dlqUrl: required('SQS_TRANSACTIONS_DLQ_URL'),
    eventsQueueUrl: required('SQS_EVENTS_QUEUE_URL'),
    accessKeyId: optional('AWS_ACCESS_KEY_ID'),
    secretAccessKey: optional('AWS_SECRET_ACCESS_KEY'),
  },
  outbox: {
    batchSize: Number(process.env.OUTBOX_BATCH_SIZE ?? 20),
    pollIntervalMs: Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1000),
  },
  consumer: {
    name: process.env.CONSUMER_NAME ?? 'wager-consumer',
    /** Desligável para que os testes controlem o consumo sem competir com o app. */
    enabled: process.env.CONSUMER_ENABLED !== 'false',
    waitTimeSeconds: Number(process.env.CONSUMER_WAIT_TIME_SECONDS ?? 5),
    batchSize: Number(process.env.CONSUMER_BATCH_SIZE ?? 10),
  },
  pendingReference: {
    maxAttempts: Number(process.env.PENDING_REFERENCE_MAX_ATTEMPTS ?? 12),
    pollIntervalMs: Number(process.env.PENDING_REFERENCE_POLL_MS ?? 5000),
    batchSize: Number(process.env.PENDING_REFERENCE_BATCH_SIZE ?? 20),
  },
} as const;
