/**
 * Master switch for every message that leaves the system (owner emails via Resend, WhatsApp).
 * OFF unless the server is started with OUTBOUND_DELIVERY=on. With it off, nothing is ever sent to a
 * guest, owner, vendor, staff member or client, even if provider keys are present: the owner's portal
 * code is shown to the administrator instead, and staff notifications are skipped.
 */
export function outboundDeliveryEnabled(): boolean {
  return String(process.env["OUTBOUND_DELIVERY"] ?? "").trim().toLowerCase() === "on";
}
export const OUTBOUND_OFF = "Outgoing messages are switched off on this system. Nothing was sent.";
