export { AuthorizationApiModule } from './authorization-api.module';
export type { AuthzApiModuleConfig } from './authz-api.options';
export { AUTHZ_ACTIONS } from './authz-api.options';

export { CurrentActor } from './current-actor.decorator';

export type { AuthzAuditEmitter, AuthzAuditEvent } from './authz-audit.port';
export { NoopAuthzAuditEmitter } from './authz-audit.port';
export { AUTHZ_AUDIT_EMITTER, AUTHZ_API_OPTIONS, AUTHZ_USER_DIRECTORY } from './tokens';

export { AuthzAccessScope } from './shared/access-scope';
export type { PersonRow, PersonProfile } from './people/authz-people-api.service';
export type { DenialListQuery } from './denials/authz-denials-api.service';
export type {
  AuthzUserDirectory,
  AuthzDirectoryUser,
  AuthzDirectoryQuery,
  AuthzDirectoryPage,
} from './people/user-directory.port';
export { InvalidDirectoryCursorError } from './people/user-directory.port';
export type { AssignableRoleView, BulkAssignResult } from './admin/authz-admin-api.service';

export type {
  AssignRoleBody,
  BulkAssignBody,
  RevokeRoleQuery,
  SetActionDescriptionBody,
  CreateDelegationBody,
  AssignmentListQuery,
  DelegationListQuery,
  ExplainAccessQuery,
  WhoCanQuery,
} from './dto/authz-api.dto';
