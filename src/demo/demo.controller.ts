import { Controller, Get, HttpCode, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';

/**
 * Sandbox-only throttled endpoints — what `@Throttle()` protects in a product, standing in so the rate-limit
 * generator (src/cli/rate-limit-history.ts) can drive real 429s through RecordingThrottlerGuard. No product behind
 * them: each answers the way its real counterpart would to a stranger. Public — the callers these limits exist for
 * aren't signed in.
 */
@Controller('demo')
export class DemoController {
  /** A payment link — public by design, so its token's entropy plus this limit are all that stand in an enumerator's way. */
  @Get('pay/:token')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  payLink(@Param('token') _token: string): never {
    throw new NotFoundException('This payment link does not exist or has expired.');
  }

  /** A sign-in — the brute-force target. */
  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(): never {
    throw new UnauthorizedException('Wrong email or password.');
  }

  /** A partner-facing read an integration polls — a well-behaved client sending correlation ids, polling too fast. */
  @Get('quotes')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  quotes() {
    return { data: [] };
  }
}
