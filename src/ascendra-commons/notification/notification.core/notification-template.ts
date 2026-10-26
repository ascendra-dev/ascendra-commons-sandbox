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

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** A value as text inside HTML — `<`, `>`, `&` and quotes can't open a tag or leave an attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Missing variables are left as visible, unresolved {{placeholders}} rather
 * than silently blanked — a blank subject/body reads as "working," a visible
 * placeholder is obviously wrong and gets noticed before it reaches a user.
 *
 * In an HTML body each value is escaped: variables carry what customers typed (a name, a reference), and unescaped
 * they could put a link or a form in the app's own email. The template's own markup is the template author's. A
 * subject is plain text in every mail client, so it is filled as given.
 */
export function renderTemplate(
  template: NotificationTemplate,
  variables: Record<string, string | number>,
): { subject?: string; body: string; isHtml?: boolean } {
  const interpolate = (text: string, html: boolean) =>
    text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      const value = variables[key];
      if (value === undefined) return match;
      return html ? escapeHtml(String(value)) : String(value);
    });

  return {
    subject: template.subject ? interpolate(template.subject, false) : undefined,
    body: interpolate(template.body, template.isHtml === true),
    isHtml: template.isHtml,
  };
}
