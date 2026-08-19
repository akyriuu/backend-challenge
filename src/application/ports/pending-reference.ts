export interface PendingReferenceStore {
  /**
   * Identificadores de reversões pendentes cuja próxima tentativa venceu, e as
   * que esgotaram o limite. A separação existe porque os dois grupos levam a
   * desfechos diferentes: reprocessar ou rejeitar.
   */
  due(limit: number): Promise<string[]>;
  exhausted(limit: number): Promise<string[]>;
}

export const PENDING_REFERENCE_STORE = Symbol('PENDING_REFERENCE_STORE');
