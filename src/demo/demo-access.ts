/**
 * The sandbox has no product, so it has no product actions — yet roles, assignments, delegations and "who can approve
 * a payout" mean nothing without them. These stand in for what a product declares (its `Actions` catalog): invoices,
 * payments, payouts, customers, reports — all tenant-scope. No endpoint enforces them; authorization's console,
 * explain and who-can read them like any other action.
 */
export const DEMO_ACTIONS = {
  INVOICE_VIEW: 'invoice.view',
  INVOICE_CREATE: 'invoice.create',
  INVOICE_SEND: 'invoice.send',
  INVOICE_VOID: 'invoice.void',
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_REFUND: 'payment.refund',
  PAYOUT_VIEW: 'payout.view',
  PAYOUT_APPROVE: 'payout.approve',
  CUSTOMER_VIEW: 'customer.view',
  CUSTOMER_EDIT: 'customer.edit',
  REPORT_EXPORT: 'report.export',
} as const;

const A = DEMO_ACTIONS;
/** authorization.api's — lending your own actions to a colleague (cover, a backlog). */
const LEND = 'authz.manage_delegations';

/** The product roles a tenant's people hold — what a tenant admin assigns. The working roles may lend; read-only ones can't. */
export const DEMO_ROLES: Record<string, string[]> = {
  viewer: [A.INVOICE_VIEW, A.CUSTOMER_VIEW, A.PAYOUT_VIEW],
  'billing-clerk': [A.INVOICE_VIEW, A.INVOICE_CREATE, A.INVOICE_SEND, A.CUSTOMER_VIEW, A.CUSTOMER_EDIT, A.PAYMENT_CREATE, LEND],
  'support-agent': [A.INVOICE_VIEW, A.CUSTOMER_VIEW, A.CUSTOMER_EDIT, A.PAYMENT_REFUND, LEND],
  'finance-approver': [A.INVOICE_VIEW, A.INVOICE_VOID, A.PAYOUT_VIEW, A.PAYOUT_APPROVE, A.PAYMENT_REFUND, A.REPORT_EXPORT, LEND],
  auditor: [A.INVOICE_VIEW, A.PAYOUT_VIEW, A.CUSTOMER_VIEW, A.REPORT_EXPORT],
};

/** What each action means — the console's catalog descriptions. Two are left undescribed on purpose (catalog health). */
export const DEMO_DESCRIPTIONS: Record<string, string> = {
  'invoice.view': 'See invoices and their history',
  'invoice.create': 'Draft new invoices',
  'invoice.send': 'Send an invoice to its customer',
  'invoice.void': 'Void an issued invoice',
  'payment.create': 'Record a payment against an invoice',
  'payment.refund': 'Refund a captured payment',
  'payout.approve': 'Approve an outbound payout',
  'customer.view': 'See customer records',
  'customer.edit': 'Change customer details',
  'audit.view': "Read the tenant's audit log",
  'authz.view': 'See who can do what — roles, assignments, delegations',
  'authz.assign_roles': 'Give and take away roles in the tenant',
  'authz.manage_delegations': 'Lend your own actions to someone else for a while',
  'authz.platform': 'Act across every tenant in the access console',
  'authz.manage_catalog': 'Describe actions in the catalog',
  'rate-limit.view': 'Read the rate-limit log (every tenant)',
  'idempotency.view': 'Read idempotency claims (every tenant)',
  'idempotency.view-response': "Read a claim's saved response — can hold personal data",
  'domain-events.view': 'Read domain-event deliveries and wiring',
  'job.view': 'See background jobs and their runs',
  'job.run': 'Run a background job now',
};
