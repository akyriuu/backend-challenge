import { IsString, Matches } from 'class-validator';
import { Money } from '@/domain/money';

export class MoneyDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message:
      'amount deve ser decimal com no máximo duas casas, sem notação científica',
  })
  amount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency deve ser código ISO-4217' })
  currency!: string;

  toMoney(): Money {
    return Money.from({ amount: this.amount, currency: this.currency });
  }
}
