export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidAmountError extends DomainError {
  constructor(value: string) {
    super(`Valor monetário inválido: "${value}"`);
  }
}

export class InvalidCurrencyError extends DomainError {
  constructor(currency: string) {
    super(
      `Moeda inválida: "${currency}" (esperando código ISO de três letras maíusculas)`,
    );
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(expected: string, actual: string) {
    super(`Operação entre moedas distintas: ${expected} e ${actual}`);
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(available: string, requested: string) {
    super(
      `Saldo insuficiente: disponível ${available}, solicitado ${requested}`,
    );
  }
}
