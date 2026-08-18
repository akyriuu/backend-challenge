const required = (name: string): string => { 
    const value = process.env[name];

    if(!value) { 
        throw new Error(`Varíavel de ambiente obrigatória não encontrada: ${name}`);
    }

    return value;
};

export const env = {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    sqs: { 
      region: required('AWS_REGION'),
      endpoint: process.env.SQS_ENDPOINT,
      queueUrl: required('SQS_QUEUE_URL'),
    }
};
