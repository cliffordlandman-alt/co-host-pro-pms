import { db, staffTable } from "@workspace/db";
import { outboundDeliveryEnabled } from "./outbound";
import { eq, or, and, isNotNull } from "drizzle-orm";

const GRAPH_URL = "https://graph.facebook.com/v19.0";

export function isWhatsAppConfigured(): boolean {
  return !!(process.env["WHATSAPP_API_TOKEN"] && process.env["WHATSAPP_PHONE_NUMBER_ID"]);
}

/** Keys present AND outgoing messages switched on (OUTBOUND_DELIVERY=on). */
export function isWhatsAppDeliveryOn(): boolean {
  return outboundDeliveryEnabled() && isWhatsAppConfigured();
}

function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return "971" + digits.slice(1);
  return digits;
}

export async function sendWhatsApp(to: string, body: string): Promise<boolean> {
  if (!outboundDeliveryEnabled()) {
    console.warn("[WhatsApp] Outgoing messages are switched off (OUTBOUND_DELIVERY is not 'on'); nothing sent");
    return false;
  }
  const token = process.env["WHATSAPP_API_TOKEN"];
  const phoneId = process.env["WHATSAPP_PHONE_NUMBER_ID"];

  if (!token || !phoneId) {
    console.warn("[WhatsApp] Not configured — skipping notification");
    return false;
  }

  const phone = normalisePhone(to);
  if (phone.length < 7) {
    console.warn("[WhatsApp] Invalid phone, skipping:", to);
    return false;
  }

  try {
    const res = await fetch(`${GRAPH_URL}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body, preview_url: false },
      }),
    });

    const data = await res.json() as any;
    if (!res.ok) {
      console.error("[WhatsApp] Send failed to", phone, ":", data?.error?.message ?? JSON.stringify(data));
      return false;
    }

    console.log("[WhatsApp] Sent to", phone, "— message id:", data.messages?.[0]?.id);
    return true;
  } catch (err: any) {
    console.error("[WhatsApp] Network error:", err?.message);
    return false;
  }
}

export async function notifyManagers(message: string): Promise<void> {
  if (!isWhatsAppDeliveryOn()) return;
  const managers = await db
    .select({ id: staffTable.id, name: staffTable.name, phone: staffTable.phone })
    .from(staffTable)
    .where(
      and(
        eq(staffTable.active, true),
        isNotNull(staffTable.phone),
        or(eq(staffTable.role, "admin"), eq(staffTable.role, "manager"))
      )
    );

  await Promise.allSettled(
    managers.filter(m => m.phone).map(m => sendWhatsApp(m.phone!, message))
  );
}

export async function notifyStaffMember(staffId: number, message: string): Promise<boolean> {
  if (!isWhatsAppDeliveryOn()) return false;
  const [member] = await db
    .select({ phone: staffTable.phone, name: staffTable.name })
    .from(staffTable)
    .where(eq(staffTable.id, staffId));

  if (!member?.phone) return false;
  return sendWhatsApp(member.phone, message);
}
