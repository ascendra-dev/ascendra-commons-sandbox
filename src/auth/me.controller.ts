import { Controller, Get, Inject } from '@nestjs/common';
import {
  AUTHORIZER,
  computeSessionSnapshot,
  CurrentActor,
  NoActionRequired,
  type Actor,
  type Authorizer,
} from '../ascendra-commons/authorization/authorization.core';
import { ALL_ACTIONS } from '../modules/commons/authorization';

/** `GET /me` — who's signed in and which actions they hold, fetched once by the frontend to show or hide nav. */
@Controller('me')
export class MeController {
  constructor(@Inject(AUTHORIZER) private readonly authorizer: Authorizer) {}

  @Get()
  @NoActionRequired()
  me(@CurrentActor() actor: Actor) {
    return computeSessionSnapshot(actor, ALL_ACTIONS, this.authorizer);
  }
}
