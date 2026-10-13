// Emails to owners (login code, monthly statement). The company shown is Settings → Company → "Company name on
// documents"; the product name appears only as "Owner Portal by LaunchRiot"-style wording, never the old brand.
import { BRAND } from './brand.mjs';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function ownerCodeEmail({ ownerName, code, company = BRAND }) {
  const co = esc(company);
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#f8fafc;padding:32px;border-radius:12px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:22px;font-weight:700;color:#0f2a3f">${co}</div>
        <div style="font-size:13px;color:#64748b">Owner Portal</div>
      </div>
      <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e2e8f0">
        <p style="margin:0 0 12px;color:#1e293b">Hi ${esc(ownerName)},</p>
        <p style="margin:0 0 20px;color:#475569">Your one-time access code for the ${co} Owner Portal is:</p>
        <div style="background:#0f2a3f;color:#5eead4;font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;border-radius:8px;margin:0 0 20px">
          ${esc(code)}
        </div>
        <p style="margin:0 0 8px;color:#64748b;font-size:13px">This code expires in <strong>15 minutes</strong> and can only be used once.</p>
        <p style="margin:0;color:#94a3b8;font-size:12px">If you didn't request this code, please ignore this email.</p>
      </div>
      <div style="text-align:center;margin-top:20px;color:#94a3b8;font-size:11px">
        ${co} · Owner Portal powered by ${esc(BRAND)}
      </div>
    </div>
  `;
  return { subject: `${code} — Your ${company} Owner Portal code`, html };
}

export function statementEmail({ ownerName, propertyName, statement: st, company = BRAND }) {
  const m = (v) => `${st.currency || 'AED'} ${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const html = `<div style="font-family:sans-serif;max-width:520px"><p>Hi ${esc(ownerName)},</p><p>Your owner statement for <b>${esc(propertyName)}</b>, ${esc(st.month)}, is ready in the Owner Portal.</p>
    <p>Stays: ${esc(st.bookingsCount)} · Gross: ${m(st.grossRevenue)}${Number(st.paidByAirbnb) ? ` · Already paid to you by Airbnb: ${m(st.paidByAirbnb)}` : ''} · Balance: ${m(st.ownerPayout)}</p>
    <p style="color:#64748b;font-size:12px">${esc(company)}</p></div>`;
  return { subject: `Owner statement ${st.month} · ${propertyName} · ${company}`, html };
}
