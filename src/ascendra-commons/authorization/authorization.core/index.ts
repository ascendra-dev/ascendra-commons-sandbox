export type { Actor } from './actor.type';

export type { Authorizer } from './authorizer.port';
export { MissingAuthorizer, MissingAuthorizerError } from './missing-authorizer';

export {
  RequiresAction,
  NoActionRequired,
  ACTION_METADATA_KEY,
  NO_ACTION_REQUIRED_KEY,
} from './requires-action.decorator';
export { AuthorizationGuard, AuthorizationNotDeclaredError } from './authorization.guard';
export { CurrentActor } from './current-actor.decorator';

export type { SessionSnapshot } from './session-snapshot';
export { computeSessionSnapshot } from './session-snapshot';

export type { ActionAvailability, StateValidity } from './action-availability';
export { computeActionAvailability } from './action-availability';

export { AuthorizationModule } from './authorization.module';
export type { AuthorizationModuleConfig } from './authorization.module';

export { AUTHORIZER } from './tokens';
