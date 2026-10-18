import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { DEV_ACTORS } from './dev-actors';
import { DevTokenService } from './dev-token.service';
import { Public } from './public.decorator';

/** Dev sign-in: list who you can be, get a token for one of them. Not registered in production. */
@Controller('dev')
export class DevAuthController {
  constructor(private readonly tokens: DevTokenService) {}

  @Get('personas')
  @Public()
  personas() {
    return DEV_ACTORS;
  }

  @Post('token')
  @Public()
  async token(@Body() body: { actorId?: string }) {
    const actor = DEV_ACTORS.find((a) => a.id === body?.actorId);
    if (!actor) throw new NotFoundException(`No dev actor "${body?.actorId ?? ''}" — see GET /dev/personas.`);
    const { label: _label, name: _name, ...rest } = actor;
    const signed = await this.tokens.sign(rest);
    return { ...signed, actor: rest };
  }
}
