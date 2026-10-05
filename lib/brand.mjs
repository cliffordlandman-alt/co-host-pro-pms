// The product name users and owners see (window title, sidebar, login, owner portal, emails, calendar name).
// Renamed from YallaStay / YallaPMS on 4 Oct 2026. Internal identifiers (package names, database, folders, env vars,
// LaunchAgent labels, ports, localStorage keys, iCal UIDs, the x-yallapms-check header) deliberately keep the old name
// so existing installs, deploy paths and calendar subscriptions keep working.
export const BRAND = 'Co-Host Pro';

/** Default sender when RESEND_FROM_EMAIL is not set. The address stays on the domain already set up for sending. */
export const DEFAULT_FROM_EMAIL = `${BRAND} <noreply@yallastay.ae>`;

/** Settings → Company → "Company name on documents" (company.documentName); falls back to the product name. */
export function documentName(company) {
  const v = company && typeof company === 'object' ? company.documentName : undefined;
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s ? s.slice(0, 120) : BRAND;
}
