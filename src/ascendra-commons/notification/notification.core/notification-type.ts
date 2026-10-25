/**
 * The notification types an app sends, declared in code — `NotificationModule.forRoot({ types })`. A type is a
 * `notificationType` string plus what an admin needs to configure it: what it's for, who gets it, and which
 * `{{variables}}` its templates may use (with a sample value each, for a preview or a test send).
 *
 * Optional: an app that declares none gets today's behaviour — any string routes and renders. Once declared,
 * `notification.api` lists them, rejects a route or template for a type that isn't declared, and rejects template
 * text using a variable the type doesn't have.
 */
export interface NotificationTypeDefinition {
  /** The `notificationType` a caller passes to `notify()` — e.g. `'invoice.sent'`. */
  name: string;
  /** What it's for — shown beside it in the console. */
  description?: string;
  /** Who receives it — a label for the console (`'payer'`, `'tenant staff'`, `'platform staff'`). */
  audience?: string;
  /** The variables its templates may use. */
  variables?: NotificationVariableDefinition[];
  /**
   * Always sent — a user can't turn it off in their preferences: a password reset, a security alert, a legally required
   * notice. Default `false`.
   */
  required?: boolean;
}

export interface NotificationVariableDefinition {
  name: string;
  description?: string;
  /** What a preview or test send fills it with. */
  sample?: string | number;
}

/** `{{name}}` placeholders in a template's text — the same pattern `renderTemplate` fills. */
export function templateVariables(...texts: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(/\{\{(\w+)\}\}/g)) found.add(match[1]);
  }
  return [...found];
}

/** A type's sample values — `{ invoiceNumber: 'INV-0042', amount: '4,820.00' }`. */
export function sampleVariables(type: NotificationTypeDefinition | undefined): Record<string, string | number> {
  return Object.fromEntries((type?.variables ?? []).filter((v) => v.sample !== undefined).map((v) => [v.name, v.sample!]));
}
