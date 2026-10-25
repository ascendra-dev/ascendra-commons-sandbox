/**
 * The app's tenants — which ones a default route must be checked for. Optional: bind it under
 * `NotificationApiModule.forRoot({ tenantDirectoryToken })` and the coverage gaps check every tenant; leave it unbound
 * and they check the tenants the notification config names (a tenant with no config row at all goes unchecked).
 */
export interface NotificationTenantDirectory {
  listTenantIds(): Promise<string[]>;
}
