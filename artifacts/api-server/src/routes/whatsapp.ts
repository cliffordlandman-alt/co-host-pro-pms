import { Router } from "express";
import { sendWhatsApp, isWhatsAppConfigured } from "../lib/whatsapp";
import { outboundDeliveryEnabled, OUTBOUND_OFF } from "../lib/outbound";

const router = Router();

router.get("/whatsapp/status", (_req, res) => {
  res.json({
    configured: isWhatsAppConfigured(),
    deliveryEnabled: outboundDeliveryEnabled(),
    phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"]
      ? `...${process.env["WHATSAPP_PHONE_NUMBER_ID"].slice(-4)}`
      : null,
    tokenSet: !!process.env["WHATSAPP_API_TOKEN"],
  });
});

router.post("/whatsapp/test", async (req, res) => {
  const { phone, message } = req.body as { phone?: string; message?: string };
  if (!phone) return res.status(400).json({ error: "phone is required" });
  if (!outboundDeliveryEnabled()) return res.status(503).json({ error: OUTBOUND_OFF });

  const text = message ?? "✅ Co-Host Pro WhatsApp notifications are working correctly!";
  const ok = await sendWhatsApp(phone, text);
  if (!ok) {
    return res.status(500).json({
      error: isWhatsAppConfigured()
        ? "Message send failed — check API token and phone number ID"
        : "WhatsApp not configured — add WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID secrets",
    });
  }
  res.json({ success: true, sentTo: phone });
});

export default router;
