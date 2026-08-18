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
    accessKeyId: optional('AWS_ACCESS_KEY_ID'),
    secretAccessKey: optional('AWS_SECRET_ACCESS_KEY'),
  },
} as const;
