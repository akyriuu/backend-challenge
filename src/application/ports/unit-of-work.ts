import type { IntegrationEvent } from '@/domain/events/integration-event';
import type {
  WagerTransaction,
  WagerTransactionKind,
} from '@/domain/wager-transaction';
import type { Wallet } from '@/domain/wallet';
import type { WalletLedgerEntry } from '@/domain/wallet-ledger-entry';

export interface LedgerSummary {
  debits: string;
  credits: string;
  entries: number;
}

export interface InboxEntry {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface WalletRepository {
  findForUpdate(walletId: string): Promise<Wallet | null>;
  add(wallet: Wallet): Promise<void>;
  save(wallet: Wallet): Promise<void>;
}

export interface WagerTransactionRepository {
  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransaction | null>;
  findByProviderReference(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;
  hasReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<boolean>;
  add(transaction: WagerTransaction): Promise<void>;
}

export interface LedgerRepository {
  append(entry: WalletLedgerEntry): Promise<void>;
  findByTransaction(transactionId: string): Promise<WalletLedgerEntry | null>;
  summarize(walletId: string): Promise<LedgerSummary>;
}

export interface InboxRepository {
  /** Devolve `false` quando a mensagem já havia sido registrada. */
  register(entry: InboxEntry): Promise<boolean>;
}

export interface OutboxRepository {
  enqueue(event: IntegrationEvent<object>): Promise<void>;
}

export interface TransactionalContext {
  wallets: WalletRepository;
  transactions: WagerTransactionRepository;
  ledger: LedgerRepository;
  inbox: InboxRepository;
  outbox: OutboxRepository;
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface UnitOfWork {
  run<T>(work: (context: TransactionalContext) => Promise<T>): Promise<T>;
}
