import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  PROVIDER_IDENTITY_RESOLVER,
  type ProviderIdentity,
  type ProviderIdentityResolver,
} from './provider-identity';

declare module 'express' {
  interface Request {
    providerIdentity?: ProviderIdentity;
  }
}

@Injectable()
export class ProviderAuthGuard implements CanActivate {
  constructor(
    @Inject(PROVIDER_IDENTITY_RESOLVER)
    private readonly resolver: ProviderIdentityResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const identity = await this.resolver.resolve(request);

    if (!identity) {
      throw new UnauthorizedException('provedor não identificado');
    }

    /**
     * A verificação que dá sentido ao guard: o provedor autenticado tem que ser
     * o mesmo que o corpo declara. Com o resolvedor permissivo isso é tautologia;
     * com um Identity Provider real, é o que impede o provedor A de submeter
     * transações em nome do provedor B. O caminho de código já existe.
     */
    const body = request.body as { providerId?: unknown } | undefined;

    if (
      typeof body?.providerId === 'string' &&
      body.providerId !== identity.providerId
    ) {
      throw new ForbiddenException(
        'providerId do payload diverge da identidade autenticada',
      );
    }

    request.providerIdentity = identity;

    return true;
  }
}
