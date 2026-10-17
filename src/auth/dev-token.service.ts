import { Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import type { Actor } from '../ascendra-commons/authorization/authorization.core';

const ISSUER = 'ascendra-commons-sandbox';
const TTL_SECONDS = 12 * 60 * 60;

/** Signs and verifies dev tokens — HS256 JWTs carrying the actor. Dev only: there is no real identity behind them. */
@Injectable()
export class DevTokenService {
  private readonly secret: Uint8Array;

  constructor() {
    const secret = process.env.DEV_AUTH_SECRET;
    if (!secret) throw new Error('DEV_AUTH_SECRET is not set — copy .env.example to .env.');
    this.secret = new TextEncoder().encode(secret);
  }

  async sign(actor: Actor): Promise<{ token: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);
    const token = await new SignJWT({ persona: actor.persona, tenantId: actor.tenantId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(actor.id)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret);
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** The token's actor, or null when it's invalid, expired or not one of ours. */
  async verify(token: string): Promise<Actor | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload.persona !== 'string') return null;
      const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null;
      return { id: payload.sub, persona: payload.persona, tenantId };
    } catch {
      return null;
    }
  }
}
