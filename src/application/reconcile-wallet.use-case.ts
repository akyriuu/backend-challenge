import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { UNIT_OF_WORK, type UnitOfWork } from './ports/unit-of-work';
import { METRICS, noopMetrics, type Metrics } from './ports/metrics';
import { Money } from '@/domain/money';
import { WalletNotFoundError } from './errors';

export interface ReconcileWalletResult {
  walletId: string;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

@Injectable()
export class ReconcileWallet {
  private readonly logger = new Logger(ReconcileWallet.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Optional()
    @Inject(METRICS)
    private readonly metrics: Metrics = noopMetrics,
  ) {}

  async execute(walletId: string): Promise<ReconcileWalletResult> {
    return this.unitOfWork.run(async (context) => {
      /**
       * A carteira é lida sob lock antes de somar o ledger. Sem isso, uma escrita
       * concorrente entre a leitura do saldo e a soma dos lançamentos produziria
       * divergência falsa — e uma reconciliação que grita lobo perde a serventia.
       */
      const wallet = await context.wallets.findForUpdate(walletId);

      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }

      const summary = await context.ledger.summarize(walletId);
      const currency = wallet.currency;

      const calculatedBalance = Money.from({
        amount: summary.credits,
        currency,
      }).subtract(Money.from({ amount: summary.debits, currency }));

      const difference = wallet.balance.subtract(calculatedBalance);
      const consistent = difference.isZero();

      this.metrics.increment('wager_reconciliations_total', {
        consistent: String(consistent),
      });

      if (!consistent) {
        this.metrics.increment('wager_reconciliation_divergences_total');

        this.logger.warn({
          message: 'divergência de reconciliação detectada',
          walletId,
          storedBalance: wallet.balance.toString(),
          calculatedBalance: calculatedBalance.toString(),
          difference: difference.toString(),
          checkedEntries: summary.entries,
        });
      }

      return {
        walletId,
        storedBalance: wallet.balance,
        calculatedBalance,
        difference,
        consistent,
        checkedEntries: summary.entries,
      };
    });
  }
}
