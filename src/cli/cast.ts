/**
 * Who and what the generated history is about. Tenant ids and the admin / platform actors match the dev sign-in users
 * (src/auth/dev-actors.ts), so signing in as `admin@acme.test` shows Acme's own history. Actors are just the ids the
 * audit records carry.
 */
export const PLATFORM_ADMIN = 'platform.admin@ascendra.test';

/** Changes no person made: the payment gateway's webhooks. */
export const PAYMENT_GATEWAY = 'system:payment-gateway';

export interface BillingAddress {
  street: string;
  city: string;
  country: string;
}

export interface CastTenant {
  id: string;
  name: string;
  plan: string;
  currency: string;
  /** Invoices on a busy weekday — tenants differ in volume, so the per-tenant charts aren't flat. */
  dailyInvoices: number;
  admin: { id: string; name: string };
  staff: { id: string; name: string; title: string }[];
}

export const TENANTS: CastTenant[] = [
  {
    id: 'tenant_acme', name: 'Acme Holdings', plan: 'growth', currency: 'PKR', dailyInvoices: 5,
    admin: { id: 'admin@acme.test', name: 'Ayesha Malik' },
    staff: [
      { id: 'jane@acme.test', name: 'Jane Cooper', title: 'Billing specialist' },
      { id: 'omer@acme.test', name: 'Omer Siddiqui', title: 'Accounts receivable' },
      { id: 'rabia@acme.test', name: 'Rabia Farooq', title: 'Finance lead' },
    ],
  },
  {
    id: 'tenant_globex', name: 'Globex Corporation', plan: 'starter', currency: 'USD', dailyInvoices: 3,
    admin: { id: 'admin@globex.test', name: 'Hank Scorpio' },
    staff: [
      { id: 'ali@globex.test', name: 'Ali Raza', title: 'Billing clerk' },
      { id: 'sara@globex.test', name: 'Sara Khan', title: 'Controller' },
    ],
  },
  {
    id: 'tenant_meridian', name: 'Meridian Health', plan: 'enterprise', currency: 'GBP', dailyInvoices: 4,
    admin: { id: 'admin@meridian.test', name: 'Fatima Sheikh' },
    staff: [
      { id: 'li@meridian.test', name: 'Li Wei', title: 'Revenue cycle analyst' },
      { id: 'noah@meridian.test', name: 'Noah Bennett', title: 'Billing coordinator' },
    ],
  },
];

export const CUSTOMERS: { name: string; address: BillingAddress }[] = [
  { name: 'Ahmed Family Trust', address: { street: '14 Canal View Rd', city: 'Lahore', country: 'PK' } },
  { name: 'Northwind Traders', address: { street: '221 Harbour St', city: 'Karachi', country: 'PK' } },
  { name: 'Contoso Clinics', address: { street: '9 Kingsway', city: 'London', country: 'GB' } },
  { name: 'Initech LLC', address: { street: '4120 Freidrich Ln', city: 'Austin', country: 'US' } },
  { name: 'Umbrella Labs', address: { street: '1 Raccoon Plaza', city: 'Denver', country: 'US' } },
  { name: 'Stark Logistics', address: { street: '77 Wharf Lane', city: 'Manchester', country: 'GB' } },
  { name: 'Wayne Learning Centre', address: { street: '1007 Mountain Dr', city: 'Islamabad', country: 'PK' } },
  { name: 'Tyrell Biotech', address: { street: '2019 Spinner Ave', city: 'Seattle', country: 'US' } },
  { name: 'Hooli Retail', address: { street: '5 Valley Blvd', city: 'Palo Alto', country: 'US' } },
  { name: 'Cyberdyne Systems', address: { street: '18144 El Camino', city: 'Sunnyvale', country: 'US' } },
];

export const STREETS = ['Plot 12, Gulberg III', '88 Mall Road', '3rd Floor, Blue Area', '45 Baker Street', '600 Congress Ave'];

export const SERVICES = [
  'Monthly retainer', 'Annual licence', 'Implementation services', 'Support hours', 'Training workshop',
  'Hardware rental', 'Consulting — discovery phase', 'Data migration', 'On-site visit', 'Premium SLA uplift',
];

export const PAYMENT_METHODS = ['card', 'bank_transfer', 'wallet'];

export const FAILURE_REASONS = [
  'Card declined by issuer', 'Insufficient funds', 'Bank transfer returned — account closed',
  'Authentication (3-D Secure) not completed',
];

export const VOID_REASONS = [
  'Duplicate of an invoice already sent',
  'Customer cancelled the order before delivery',
  // A long one, so the UI's reason cell / tooltip has something to wrap.
  'Issued against the wrong customer account after the March re-org merged two billing profiles; the correct invoice ' +
    'has been re-issued under the consolidated account and the customer has confirmed receipt by email.',
];

export const REFUND_REASONS = ['Goodwill credit after a service outage', 'Overcharged — wrong rate card applied'];

export const ROUTE_EVENTS = ['invoice.issued', 'invoice.paid', 'payment.failed'];
