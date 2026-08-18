import { defineEntity, p, type InferEntity } from '@mikro-orm/core';

export const WalletSchema = defineEntity({
  name: 'Wallet',
  tableName: 'wallets',
  properties: {
    id: p.uuid().primary(),
    playerId: p.uuid(),
    currency: p.string(),
    balanceAmount: p.decimal(),
    version: p.integer(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export type WalletRecord = InferEntity<typeof WalletSchema>;
