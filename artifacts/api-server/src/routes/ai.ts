import { Router } from "express";
import OpenAI from "openai";
import {
  db,
  propertiesTable,
  reservationsTable,
  maintenanceTicketsTable,
  cleaningTasksTable,
  reviewsTable,
  aiRequestsTable,
} from "@workspace/db";
import { desc } from "drizzle-orm";
import { BRAND } from "../../../../lib/brand.mjs";
import { documentCompanyName } from "./app-settings";

const router = Router();
const MODEL = "gpt-4o-mini";

function makeOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

async function trackRequest(
  tool: string,
  prompt: string,
  result: string,
  usage?: OpenAI.CompletionUsage | null,
  propertyId?: number | null
) {
  try {
    await db.insert(aiRequestsTable).values({
      tool,
      prompt: prompt.slice(0, 4000),
      result: result.slice(0, 8000),
      model: MODEL,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      propertyId: propertyId ?? null,
    });
  } catch (e) {
    console.error("[AI] trackRequest failed:", e);
  }
}

const SYSTEM_PROMPT = `You are an expert AI assistant in ${BRAND}, the property management app of a premium Dubai holiday home management company. You help property managers with:
- Writing guest messages (confirmations, check-in instructions, review requests, payment reminders)
- Drafting owner updates and monthly summaries
- Summarising maintenance issues and creating repair summaries
- Explaining financial breakdowns and owner payouts
- Generating listing descriptions for properties
- Suggesting operational improvements and next actions
- Creating professional WhatsApp and email messages

Always be warm, professional, and concise. Format responses clearly. Use AED for currency. Write in the tone of a premium Dubai hospitality brand.`;

async function buildContext(): Promise<string> {
  try {
    const [props, res, maint, clean] = await Promise.all([
      db.select({ id: propertiesTable.id, name: propertiesTable.name }).from(propertiesTable).limit(20),
      db.select({ id: reservationsTable.id, guestName: reservationsTable.guestName, status: reservationsTable.status }).from(reservationsTable).orderBy(desc(reservationsTable.createdAt)).limit(10),
      db.select({ id: maintenanceTicketsTable.id, issue: maintenanceTicketsTable.issue, status: maintenanceTicketsTable.status }).from(maintenanceTicketsTable).orderBy(desc(maintenanceTicketsTable.createdAt)).limit(10),
      db.select({ id: cleaningTasksTable.id, status: cleaningTasksTable.status }).from(cleaningTasksTable).orderBy(desc(cleaningTasksTable.createdAt)).limit(10),
    ]);
    return `\n\nPortfolio context: ${props.length} properties, ${res.length} recent reservations, ${maint.filter(m => m.status !== "completed").length} open maintenance tickets, ${clean.filter(c => c.status !== "completed").length} pending cleanings.`;
  } catch (e) {
    console.error("[AI] buildContext failed:", e);
    return "";
  }
}

// ─── Streaming chat ────────────────────────────────────────────────────────────
router.post("/ai/chat", async (req, res) => {
  const { message, messages, context } = req.body as {
    message?: string;
    messages?: Array<{ role: string; content: string }>;
    context?: Record<string, unknown>;
  };

  if (typeof message === "string") {
    if (!message.trim()) return res.status(400).json({ error: "message is empty" });
    try {
      const client = makeOpenAI();
      const resp = await client.chat.completions.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: message }],
      });
      const output = resp.choices[0]?.message?.content ?? "";
      void trackRequest("chat", message, output, resp.usage);
      return res.json({ output });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (obj: object) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const client = makeOpenAI();
    const ctxStr = await buildContext();
    const extraCtx = context ? `\n\nExtra context: ${JSON.stringify(context)}` : "";

    const stream = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: SYSTEM_PROMPT + ctxStr + extraCtx },
        ...(messages as OpenAI.ChatCompletionMessageParam[]),
      ],
    });

    let fullResponse = "";
    let usage: OpenAI.CompletionUsage | null = null;
    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) { fullResponse += text; send({ content: text }); }
      if (chunk.usage) usage = chunk.usage;
    }

    void trackRequest("chat", messages[messages.length - 1]?.content ?? "", fullResponse, usage);
    send({ done: true });
    res.end();
  } catch (err: any) {
    console.error("[AI chat] error:", err?.message);
    send({ content: `Sorry, I ran into an error: ${err?.message ?? "unknown"}` });
    send({ done: true });
    res.end();
  }
});

// ─── Tool: Listing Description ────────────────────────────────────────────────
router.post("/ai/tools/listing-description", async (req, res) => {
  const { propertyName, bedrooms, bathrooms, area, amenities, highlights, propertyId } = req.body as {
    propertyName: string; bedrooms: number; bathrooms: number; area: string;
    amenities: string[]; highlights?: string; propertyId?: number;
  };

  const prompt = `Generate a compelling Airbnb listing description for the following Dubai property:

Property: ${propertyName}
Location: ${area}, Dubai
Bedrooms: ${bedrooms} | Bathrooms: ${bathrooms}
Amenities: ${amenities.join(", ")}
${highlights ? `Special highlights: ${highlights}` : ""}

Write:
1. A punchy listing TITLE (max 50 characters)
2. A compelling DESCRIPTION (200–300 words) that highlights luxury, location, and lifestyle
3. 5 BULLET POINTS of key selling points

Format with clear section headers: TITLE, DESCRIPTION, KEY FEATURES`;

  try {
    const client = makeOpenAI();
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        { role: "system", content: "You are an expert short-term rental copywriter specialising in luxury Dubai holiday homes. Write vivid, enticing, professional copy that converts browsers into bookers." },
        { role: "user", content: prompt },
      ],
    });
    const result = resp.choices[0]?.message?.content ?? "";
    void trackRequest("listing_description", prompt, result, resp.usage, propertyId);
    res.json({ result });
  } catch (err: any) {
    console.error("[AI listing] error:", err?.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Tool: Dynamic Pricing Suggestion ────────────────────────────────────────
router.post("/ai/tools/pricing-suggestion", async (req, res) => {
  const { propertyName, baseRate, occupancyRate, season, area, bedrooms, nearbyEvents, propertyId } = req.body as {
    propertyName: string; baseRate: number; occupancyRate: number; season: string;
    area: string; bedrooms: number; nearbyEvents?: string; propertyId?: number;
  };

  const prompt = `Provide dynamic pricing recommendations for this Dubai holiday home:

Property: ${propertyName} (${bedrooms}BR, ${area})
Current base rate: AED ${baseRate}/night
Occupancy last 30 days: ${occupancyRate}%
Season: ${season}
${nearbyEvents ? `Nearby events/demand drivers: ${nearbyEvents}` : ""}

Provide:
1. RECOMMENDED RATE with reasoning (AED/night)
2. WEEKEND RATE premium recommendation
3. MINIMUM STAY suggestion for current season
4. 3 SPECIFIC ACTIONS to improve occupancy
5. COMPETITIVE POSITIONING (where this property should sit in the market)

Be specific with numbers. Reference Dubai STR market dynamics.`;

  try {
    const client = makeOpenAI();
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        { role: "system", content: "You are a Dubai short-term rental revenue management expert with deep knowledge of Airbnb, Booking.com, and direct booking dynamics in the Dubai market (DTCM regulations, peak/off seasons, areas like Marina, Downtown, JBR, Business Bay, Palm Jumeirah)." },
        { role: "user", content: prompt },
      ],
    });
    const result = resp.choices[0]?.message?.content ?? "";
    void trackRequest("pricing_suggestion", prompt, result, resp.usage, propertyId);
    res.json({ result });
  } catch (err: any) {
    console.error("[AI pricing] error:", err?.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Tool: WhatsApp Message Draft ────────────────────────────────────────────
router.post("/ai/tools/whatsapp-draft", async (req, res) => {
  const { messageType, guestName, propertyName, checkIn, checkOut, extraInfo, propertyId } = req.body as {
    messageType: string; guestName: string; propertyName: string;
    checkIn?: string; checkOut?: string; extraInfo?: string; propertyId?: number;
  };

  const TYPE_CONTEXTS: Record<string, string> = {
    booking_confirmation: "a warm booking confirmation welcoming the guest and confirming their reservation details",
    check_in_instructions: "detailed check-in instructions including how to access the property, parking, WiFi, and what to expect on arrival",
    checkout_reminder: "a friendly checkout reminder with checkout time, instructions for leaving the property, and an offer to assist",
    payment_reminder: "a polite payment reminder noting the outstanding balance and payment options",
    review_request: "a warm, friendly review request sent 24 hours after checkout asking for an honest review",
    mid_stay_check: "a mid-stay check-in message asking if everything is perfect and offering assistance",
    late_checkout_offer: "a late checkout offer as an upsell, mentioning the fee and availability",
  };

  const context = TYPE_CONTEXTS[messageType] ?? "a professional guest message";
  const company = await documentCompanyName();

  const prompt = `Write ${context} for:

Guest: ${guestName}
Property: ${propertyName}
${checkIn ? `Check-in: ${checkIn}` : ""}
${checkOut ? `Check-out: ${checkOut}` : ""}
${extraInfo ? `Additional context: ${extraInfo}` : ""}

Requirements:
- WhatsApp-optimised format (use line breaks, minimal punctuation)
- Warm but professional tone matching premium Dubai hospitality
- Max 150 words
- End with a warm sign-off from "The ${company} Team"
- Do NOT use markdown formatting (no ** or ##)`;

  try {
    const client = makeOpenAI();
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 512,
      messages: [
        { role: "system", content: "You write professional WhatsApp messages for a premium Dubai holiday home management company. Messages are warm, clear, and formatted for mobile reading." },
        { role: "user", content: prompt },
      ],
    });
    const result = resp.choices[0]?.message?.content ?? "";
    void trackRequest("whatsapp_draft", prompt, result, resp.usage, propertyId);
    res.json({ result });
  } catch (err: any) {
    console.error("[AI whatsapp] error:", err?.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Tool: Review Analysis ────────────────────────────────────────────────────
router.post("/ai/tools/review-analysis", async (req, res) => {
  const { reviews, propertyId } = req.body as { reviews: string; propertyId?: number };

  if (!reviews?.trim()) return res.status(400).json({ error: "reviews text is required" });

  const prompt = `Analyse the following guest reviews for a Dubai holiday home and provide a structured report:

---REVIEWS---
${reviews}
---END REVIEWS---

Provide:
1. OVERALL SENTIMENT: score out of 10 with brief summary
2. TOP POSITIVES: 3–5 recurring positive themes guests mention most
3. RECURRING ISSUES: 3–5 specific problems or complaints that appear more than once
4. HIDDEN OPPORTUNITIES: 2–3 improvements that would most impact ratings
5. SUGGESTED RESPONSE STRATEGY: how to address the most critical issues operationally
6. PRIORITY ACTION ITEM: the single most important thing to fix

Be specific — quote or paraphrase actual guest language where relevant.`;

  try {
    const client = makeOpenAI();
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [
        { role: "system", content: "You are a hospitality quality analyst specialising in short-term rental review analysis. You identify patterns, surface hidden insights, and provide actionable recommendations to improve guest experience." },
        { role: "user", content: prompt },
      ],
    });
    const result = resp.choices[0]?.message?.content ?? "";
    void trackRequest("review_analysis", reviews.slice(0, 2000), result, resp.usage, propertyId);
    res.json({ result });
  } catch (err: any) {
    console.error("[AI reviews] error:", err?.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Tool: Maintenance Categorization ────────────────────────────────────────
router.post("/ai/tools/categorize-maintenance", async (req, res) => {
  const { description, propertyId } = req.body as { description: string; propertyId?: number };

  if (!description?.trim()) return res.status(400).json({ error: "description is required" });

  const prompt = `Categorize and triage the following maintenance issue for a Dubai holiday home:

Issue description: "${description}"

Respond in this exact JSON format (no markdown, just valid JSON):
{
  "category": "one of: AC/Heating, Plumbing, Electrical, Appliances, Access/Locks, Furniture/Fixtures, Cleaning/Hygiene, Structural, Internet/Tech, Pool/Gym, Other",
  "priority": "one of: Emergency, High, Medium, Low",
  "priorityReason": "one sentence explaining the priority level",
  "estimatedResolutionTime": "e.g. 2-4 hours, 1-2 days, 1 week",
  "vendorType": "e.g. HVAC technician, licensed plumber, electrician, locksmith, handyman",
  "guestImpact": "one of: Critical - must relocate guest, High - significantly affects stay, Medium - inconvenient but manageable, Low - cosmetic issue",
  "immediateAction": "one specific immediate action the property manager should take right now",
  "ownerNotification": true or false
}`;

  try {
    const client = makeOpenAI();
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 512,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a property maintenance expert for Dubai holiday homes. You triage issues precisely, prioritize guest safety and comfort, and follow DTCM standards. Always respond with valid JSON." },
        { role: "user", content: prompt },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    void trackRequest("categorize_maintenance", description, raw, resp.usage, propertyId);
    const parsed = JSON.parse(raw);
    res.json({ result: parsed });
  } catch (err: any) {
    console.error("[AI maintenance cat] error:", err?.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate (legacy non-streaming) ─────────────────────────────────────────
router.post("/ai/generate", async (req, res) => {
  const { prompt, type, context } = req.body as { prompt: string; type: string; context?: Record<string, unknown> };

  const TYPE_PROMPTS: Record<string, string> = {
    guest_message: "Write a professional, warm guest message for a Dubai holiday home. Be concise and friendly.",
    owner_update: "Write a professional owner update for a Dubai property management company. Be clear and reassuring.",
    listing_description: "Write a compelling short-term rental listing description for this Dubai property. Be vivid and highlight key features.",
    maintenance_summary: "Summarize this maintenance issue clearly and professionally.",
    payout_explanation: "Explain this owner payout breakdown clearly and transparently.",
    next_action: "Suggest the most important next operational action based on this context. Be specific and actionable.",
  };

  try {
    const client = makeOpenAI();
    const system = TYPE_PROMPTS[type] ?? SYSTEM_PROMPT;
    const extra = context ? `\n\nContext:\n${JSON.stringify(context)}` : "";
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 512,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt + extra },
      ],
    });
    const result = resp.choices[0]?.message?.content ?? "";
    void trackRequest(type, prompt, result, resp.usage);
    res.json({ result });
  } catch (err: any) {
    console.error("[AI generate] error:", err?.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Usage stats ──────────────────────────────────────────────────────────────
router.get("/ai/usage", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(aiRequestsTable)
      .orderBy(desc(aiRequestsTable.createdAt))
      .limit(50);
    const total = rows.length;
    const byTool = rows.reduce((acc: Record<string, number>, r) => {
      acc[r.tool] = (acc[r.tool] ?? 0) + 1;
      return acc;
    }, {});
    const totalInputTokens = rows.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
    const totalOutputTokens = rows.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
    res.json({ total, byTool, totalInputTokens, totalOutputTokens, recent: rows.slice(0, 20) });
  } catch (err: any) {
    console.error("[AI usage] error:", err?.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
