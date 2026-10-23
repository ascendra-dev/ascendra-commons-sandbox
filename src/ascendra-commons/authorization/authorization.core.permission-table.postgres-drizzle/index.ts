// Schema — tables for typed queries; never re-export them to drizzle-kit (the DDL is migrations/)
export {
  authzRole,
  authzAction,
  authzRolePermission,
  authzUserRole,
  authzDelegation,
  authzDenial,
} from './persistence/schema';
export type { SqlExecutor } from './persistence/sql-executor';

// Seed helpers — run once at deploy time / in a migration
export { syncActions } from './seed/sync-actions';
export type { ActionCatalogEntry } from './seed/sync-actions';
export { seedRolesFromPersonaMap } from './seed/seed-roles-from-persona-map';

// Wiring
export { PostgresPermissionTableModule } from './postgres-permission-table.module';
export type { PostgresPermissionTableModuleConfig } from './postgres-permission-table.module';
export { PostgresAuthzAdminModule } from './postgres-authz-admin.module';
export type { PostgresAuthzAdminModuleConfig } from './postgres-authz-admin.module';
export { AUTHZ_SQL_EXECUTOR } from './tokens';

// The denied-requests log
export { PostgresAccessDenialRecorder, DENIAL_WINDOW_MS, OVERFLOW_ACTOR } from './denials/postgres-access-denial-recorder';
export type { PostgresAccessDenialRecorderOptions } from './denials/postgres-access-denial-recorder';
export {
  PostgresAccessDenialObservabilityService,
  PostgresAccessDenialRetention,
} from './denials/postgres-access-denial-observability.service';
export { PostgresAccessDenialRecorderModule, PostgresAccessDenialObservabilityModule } from './denials/postgres-access-denial.modules';
export type { PostgresAccessDenialModuleConfig } from './denials/postgres-access-denial.modules';
export { POSTGRES_ACCESS_DENIAL_RECORDER } from './tokens';
