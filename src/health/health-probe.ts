export interface HealthProbe { 
    readonly name: string;
    check(): Promise<void>;
}

export const HEALTH_PROBES: Symbol = Symbol('HEALTH_PROBES');