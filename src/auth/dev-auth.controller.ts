import { Body, Controller, Get, Inject, NotFoundException, Post } from '@nestjs/common';
import { DemoUserDirectory } from '../demo/demo-users';
import { DEV_ACTORS } from './dev-actors';
import { DevTokenService } from './dev-token.service';
import { Public } from './public.decorator';

/** Dev sign-in: list the personas, get a token for one of them — or for any user in the users table. Not registered in production. */
@Controller('dev')
export class DevAuthController {
  constructor(
    private readonly tokens: DevTokenService,
    @Inject(DemoUserDirectory) private readonly users: DemoUserDirectory,
  ) {}

  @Get('personas')
  @Public()
  personas() {
    return DEV_ACTORS;
  }

  @Post('token')
  @Public()
  async token(@Body() body: { actorId?: string }) {
    const actor = DEV_ACTORS.find((a) => a.id === body?.actorId);
    if (actor) {
      const { label: _label, name: _name, ...rest } = actor;
      return { ...(await this.tokens.sign(rest)), actor: rest };
    }
    // Anyone in the users table (npm run seed makes a few dozen per tenant) — their access is whatever roles they hold.
    const user = typeof body?.actorId === 'string' ? await this.users.find(body.actorId) : null;
    if (!user) throw new NotFoundException(`No dev actor or user "${body?.actorId ?? ''}" — see GET /dev/personas.`);
    const rest = { id: user.id, persona: 'user', tenantId: user.tenantId };
    return { ...(await this.tokens.sign(rest)), actor: rest };
  }
}
