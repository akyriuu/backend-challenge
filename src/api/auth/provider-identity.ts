import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

export interface ProviderIdentity {
  providerId: string;
  scopes: readonly string[];
}

export interface ProviderIdentityResolver {
  resolve(request: Request): Promise<ProviderIdentity | null>;
}

export const PROVIDER_IDENTITY_RESOLVER = Symbol('PROVIDER_IDENTITY_RESOLVER');

@Injectable()
export class TrustedPayloadIdentityResolver implements ProviderIdentityResolver {
  resolve(request: Request): Promise<ProviderIdentity | null> {
    const body = request.body as { providerId?: unknown } | undefined;
    const providerId = body?.providerId;

    if (typeof providerId !== 'string' || providerId.length === 0) {
      return Promise.resolve(null);
    }

    return Promise.resolve({ providerId, scopes: ['wagering:write'] });
  }
}
