/**
 * persona is a plain string, not a fixed union — unlike NotificationChannel
 * (email/whatsapp/sms are genuinely universal), personas vary entirely by
 * project (issuer/payer/ascendra_admin here, teacher/student/admin/parent in
 * a different Ascendra product). Each consuming project defines its own
 * Persona union and Actions catalog; this library only fixes the shape.
 *
 * tenantId is nullable — not every persona is bound to one tenant (e.g. an
 * admin persona with cross-tenant visibility, or a guest/anonymous actor).
 */
export interface Actor {
  id: string;
  persona: string;
  tenantId: string | null;
}
