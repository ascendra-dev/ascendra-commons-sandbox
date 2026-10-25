/**
 * A template for one notificationType, within one channel. `subject` and
 * `isHtml` are email-only — SMS templates just leave them unset, since SMS has
 * no subject line and no HTML concept. WhatsApp does not use this shape at all:
 * its templates are pre-approved and named on Meta's side, with positional
 * numbered parameters, not text this library renders — a separate shape for a
 * later piece.
 */
export interface NotificationTemplate {
  subject?: string;
  body: string;
  isHtml?: boolean;
}

/**
 * Missing variables are left as visible, unresolved {{placeholders}} rather
 * than silently blanked — a blank subject/body reads as "working," a visible
 * placeholder is obviously wrong and gets noticed before it reaches a user.
 */
export function renderTemplate(
  template: NotificationTemplate,
  variables: Record<string, string | number>,
): { subject?: string; body: string; isHtml?: boolean } {
  const interpolate = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      const value = variables[key];
      return value === undefined ? match : String(value);
    });

  return {
    subject: template.subject ? interpolate(template.subject) : undefined,
    body: interpolate(template.body),
    isHtml: template.isHtml,
  };
}
