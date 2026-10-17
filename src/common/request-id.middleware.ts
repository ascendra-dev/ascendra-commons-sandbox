import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

interface MinimalRequest {
  headers: Record<string, string | string[] | undefined>;
}
interface MinimalResponse {
  setHeader(name: string, value: string): void;
}

/** api-contract Rule 7: reuse an inbound `X-Request-Id` or make one, and always echo it on the response. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: MinimalRequest, res: MinimalResponse, next: () => void) {
    const inbound = req.headers['x-request-id'];
    const requestId = typeof inbound === 'string' && inbound ? inbound : randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
