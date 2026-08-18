import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, type UnitOfWork } from './ports/unit-of-work';
import {
  CLOCK,
  ID_GENERATOR,
  type Clock,
  type IdGenerator,
} from './ports/system';
import { WalletBalanceChanged } from '@/domain/events/wallet-balance-changed';
import { WagerTransactionProcessed } from '@/domain/events/wager-transaction-events';
import { Money } from '@/domain/money';
import { WagerTransaction } from '@/domain/wager-transaction';
import { Wallet } from '@/domain/wallet';

export interface OpenWalletCommand {
  playerId: string;
  initialBalance: Money;
  correlationId: string;
}

export interface OpenWalletResult {
  walletId: string;
  playerId: string;
  balance: Money;
  version: number;
}

@Injectable()
export class OpenWallet {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: OpenWalletCommand): Promise<OpenWalletResult> {
    return this.unitOfWork.run(async (context) => {
      const now = this.clock.now();
      const openingTransactionId = this.ids.next();

      const { wallet, openingEntry } = Wallet.open({
        id: this.ids.next(),
        playerId: command.playerId,
        initialBalance: command.initialBalance,
        openedAt: now,
        openingEntryId: this.ids.next(),
        openingTransactionId,
      });

      await context.wallets.add(wallet);

      if (openingEntry) {
        const opening = WagerTransaction.recordOpening({
          id: openingTransactionId,
          providerId: 'internal',
          externalTransactionId: openingTransactionId,
          idempotencyKey: `internal:${openingTransactionId}`,
          payloadHash: openingTransactionId,
          walletId: wallet.id,
          playerId: wallet.playerId,
          roundId: 'opening',
          gameId: 'internal',
          money: command.initialBalance,
          createdAt: now,
        });

        const events = {
          eventId: this.ids.next(),
          correlationId: command.correlationId,
          causationId: opening.id,
          occurredAt: now,
        };

        await context.transactions.add(opening);
        await context.ledger.append(openingEntry);
        await context.outbox.enqueue(
          WalletBalanceChanged.from(wallet, openingEntry, events),
        );
        await context.outbox.enqueue(
          WagerTransactionProcessed.from(opening, {
            ...events,
            eventId: this.ids.next(),
          }),
        );
      }

      return {
        walletId: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance,
        version: wallet.version,
      };
    });
  }
}
