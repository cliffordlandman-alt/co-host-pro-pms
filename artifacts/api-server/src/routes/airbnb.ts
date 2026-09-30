import { Router } from "express";
import { db, propertiesTable, importLogsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { syncPropertyIcal } from "../lib/sync-scheduler";

const router = Router();

function normaliseUrl(raw: string): string {
  let u = raw.trim();
  // Strip Markdown link syntax: [label](url) → url
  const mdMatch = u.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
  if (mdMatch) u = mdMatch[1];
  // Add protocol if missing
  if (/^(www\.|airbnb\.)/i.test(u)) u = "https://" + u;
  return u.trim();
}

function extractListingId(url: string): string | null {
  // Standard listing page: airbnb.*/rooms/12345678
  const roomsMatch = url.match(/airbnb\.[a-z.]+\/rooms\/(\d+)/i);
  if (roomsMatch) return roomsMatch[1];
  // iCal export URL: airbnb.*/calendar/ical/12345678.ics?t=...
  const icalMatch = url.match(/airbnb\.[a-z.]+\/calendar\/ical\/(\d+)\.ics/i);
  if (icalMatch) return icalMatch[1];
  return null;
}

function extractIcalUrl(url: string): string | null {
  return /airbnb\.[a-z.]+\/calendar\/ical\/\d+\.ics/i.test(url) ? url : null;
}

function isLikelyAirbnbUrl(url: string): boolean {
  return /airbnb\.[a-z.]+\//i.test(url) || /abnb\.me\//i.test(url);
}

function extractListingIdFromHtml(html: string, og: Record<string, string>): string | null {
  // Try og:url canonical which always contains /rooms/<id>
  const ogUrl = og["url"] || og["URL"] || "";
  const fromOg = ogUrl.match(/\/rooms\/(\d+)/i);
  if (fromOg) return fromOg[1];
  // Try canonical link tag
  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (canonicalMatch) {
    const m = canonicalMatch[1].match(/\/rooms\/(\d+)/i);
    if (m) return m[1];
  }
  // Try any /rooms/ occurrence in the HTML
  const anyRooms = html.match(/\/rooms\/(\d+)/);
  if (anyRooms) return anyRooms[1];
  return null;
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function parseOgMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const re = /<meta[^>]+property=["']og:([^"']+)["'][^>]+content=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) meta[m[1]] = m[2];
  const re2 = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:([^"']+)["']/gi;
  while ((m = re2.exec(html)) !== null) meta[m[2]] = m[1];
  return meta;
}

function extractJsonLd(html: string): Record<string, unknown> | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      if (data && (data["@type"] || data.name)) return data;
    } catch { /* continue */ }
  }
  return null;
}

function extractPhotosFromHtml(html: string): string[] {
  const seen = new Set<string>();
  const photos: string[] = [];
  // Airbnb CDN photo URLs
  const re = /https:\/\/a0\.muscache\.com\/im\/pictures\/[a-zA-Z0-9\/._%-]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s,\]}>]*)*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    // Remove query params to get base URL
    const base = m[0].split("?")[0];
    if (!seen.has(base)) {
      seen.add(base);
      photos.push(base);
    }
  }
  return photos.slice(0, 40);
}

function extractPrice(html: string): string | null {
  const patterns = [
    /AED[\s\u00a0]*(\d[\d,]+)/i,
    /\$[\s\u00a0]*(\d[\d,]+)/,
    /"price":\s*(\d+)/,
    /(\d[\d,]+)[\s\u00a0]*(?:per night|\/night|a night)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1].replace(/,/g, "");
  }
  return null;
}

function parseAmenities(html: string): string[] {
  const amenityKeywords = [
    "WiFi", "Air conditioning", "Kitchen", "Washer", "Dryer", "Pool",
    "Gym", "Free parking", "Parking", "Hot tub", "BBQ grill", "Balcony",
    "Beach access", "TV", "Coffee maker", "Dishwasher", "Iron", "Hair dryer",
    "Workspace", "EV charger", "Heating", "Elevator", "Luggage dropoff",
    "Backyard", "Garden", "Patio", "Fire pit", "Piano", "Exercise equipment",
  ];
  return amenityKeywords.filter(a => html.toLowerCase().includes(a.toLowerCase()));
}

function extractBedrooms(html: string, ld: Record<string, unknown> | null, title?: string): number | null {
  // 1. Trust the listing title first — "1 bedroom" in the name is most reliable
  if (title) {
    const m = title.match(/(\d+)\s+bedroom/i);
    if (m) return parseInt(m[1]);
    if (/studio/i.test(title)) return 0;
  }
  // 2. JSON-LD (often inaccurate — numberOfRooms includes total rooms, not bedrooms)
  // Skipped intentionally: JSON-LD numberOfRooms ≠ bedrooms
  // 3. Specific bedroom phrases in HTML (avoid picking up "3BR apartment" ads)
  const m = html.match(/(\d+)\s+bedrooms?\b/i);
  if (m) return parseInt(m[1]);
  return null;
}

function extractBathrooms(html: string, ld: Record<string, unknown> | null, title?: string): number | null {
  // 1. Trust the listing title first
  if (title) {
    const m = title.match(/(\d+(?:\.\d+)?)\s+(?:private\s+)?bath(?:room)?s?\b/i);
    if (m) return Math.floor(parseFloat(m[1]));
  }
  // 2. JSON-LD
  if (ld?.numberOfBathroomsTotal) {
    const n = parseFloat(String(ld.numberOfBathroomsTotal));
    if (!isNaN(n) && n <= 20) return Math.floor(n);
  }
  const m = html.match(/(\d+(?:\.\d+)?)\s+bath(?:room)?s?\b/i);
  if (m) return Math.floor(parseFloat(m[1]));
  return null;
}

function extractGuests(html: string, ld: Record<string, unknown> | null): number | null {
  if (ld?.occupancy) {
    const occ = ld.occupancy as Record<string, unknown>;
    if (occ?.maxValue) {
      const n = parseInt(String(occ.maxValue));
      if (!isNaN(n)) return n;
    }
  }
  const m = html.match(/(\d+)\s+(?:guest|people|person)/i);
  if (m) return parseInt(m[1]);
  return null;
}

function extractLocation(html: string, ld: Record<string, unknown> | null, og: Record<string, string>): {
  area: string | null; city: string | null; country: string | null; location: string | null;
} {
  const addr = ld?.address as Record<string, string> | null;
  const city = addr?.addressLocality || null;
  const country = addr?.addressCountry || "United Arab Emirates";
  let area: string | null = null;

  if (city) {
    area = city;
  } else if (og["locality"]) {
    area = og["locality"];
  } else {
    // Try to find Dubai area names in HTML
    const areas = ["Dubai Marina", "Downtown Dubai", "JBR", "Jumeirah Beach", "Palm Jumeirah",
      "Business Bay", "DIFC", "Jumeirah", "Al Barsha", "Mirdif", "Dubai Hills",
      "City Walk", "Bluewaters", "Creek Harbour", "Al Jaddaf", "Deira", "Bur Dubai"];
    for (const a of areas) {
      if (html.includes(a)) { area = a; break; }
    }
  }

  const location = [area, "Dubai", "United Arab Emirates"].filter(Boolean).join(", ");
  return { area, city, country, location };
}

export interface ImportReport {
  photosImported: boolean;
  pricesImported: boolean;
  amenitiesImported: boolean;
  calendarConnected: boolean;
  bookingsImported: boolean;
  importedFields: string[];
  failedFields: string[];
  errors: string[];
  importStatus: "imported_successfully" | "partially_imported" | "failed_import";
}

router.post("/airbnb/check-duplicates", async (req, res) => {
  const { listingIds } = req.body as { listingIds?: string[] };
  if (!Array.isArray(listingIds) || listingIds.length === 0) {
    return res.json({ existingIds: [] });
  }
  const existing = await db
    .select({ airbnbListingId: propertiesTable.airbnbListingId })
    .from(propertiesTable)
    .where(inArray(propertiesTable.airbnbListingId, listingIds));
  const existingIds = existing
    .map(r => r.airbnbListingId)
    .filter((id): id is string => Boolean(id));
  res.json({ existingIds });
});

router.post("/airbnb/import", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) return res.status(400).json({ error: "url is required" });

  const normUrl = normaliseUrl(url);
  console.log(`[Airbnb Import] Raw URL received: "${url}"`);
  console.log(`[Airbnb Import] Normalised URL:   "${normUrl}"`);

  let listingId = extractListingId(normUrl);
  const detectedIcalUrl = extractIcalUrl(normUrl);

  if (!listingId && !isLikelyAirbnbUrl(normUrl)) {
    console.log(`[Airbnb Import] Rejected: no listing ID found and URL does not look like Airbnb. normUrl="${normUrl}"`);
    return res.status(400).json({
      error: `Invalid Airbnb URL: "${normUrl}". Expected format: https://www.airbnb.com/rooms/123456789 or an iCal export URL.`,
    });
  }

  console.log(`[Airbnb Import] listingId=${listingId ?? "(resolving from page)"} icalDetected=${!!detectedIcalUrl}`);

  // iCal URLs: we have the listing ID already — fetch the listing page for metadata
  // Other non-standard formats: use normalised URL and resolve ID from HTML
  const fetchUrl = listingId ? `https://www.airbnb.com/rooms/${listingId}` : normUrl;
  const errors: string[] = [];
  let html = "";
  let fetchError = "";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
    });
    clearTimeout(timeout);
    if (resp.ok) {
      html = await resp.text();
    } else {
      fetchError = `Airbnb returned HTTP ${resp.status}`;
      errors.push(`Airbnb returned HTTP ${resp.status}. The listing page may be unavailable or geo-blocked.`);
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Connection failed";
    errors.push(`Could not reach Airbnb: ${fetchError}. Check your connection or try again later.`);
  }

  // Extract from all available sources
  const og = html ? parseOgMeta(html) : {};
  const ld = html ? extractJsonLd(html) : null;

  // Resolve listing ID from HTML for non-standard URL formats (/h/slug, abnb.me, etc.)
  if (!listingId && html) {
    listingId = extractListingIdFromHtml(html, og);
  }
  if (!listingId) {
    return res.status(400).json({ error: "Could not resolve an Airbnb listing ID from this URL. Make sure it links directly to a listing page." });
  }
  const photos = html ? extractPhotosFromHtml(html) : [];
  const amenities = html ? parseAmenities(html) : [];
  const baseNightlyPrice = html ? extractPrice(html) : null;
  // Use the raw og title as a source for bedroom/bathroom extraction (before HTML decode)
  const rawTitle = og["title"] || (ld?.name as string) || null;
  const bedrooms = html ? extractBedrooms(html, ld, rawTitle ?? undefined) : null;
  const bathrooms = html ? extractBathrooms(html, ld, rawTitle ?? undefined) : null;
  const guestCapacity = html ? extractGuests(html, ld) : null;
  const { area, city, country, location } = extractLocation(html, ld, og);

  // Name: OG tag is most reliable for Airbnb
  let name: string | null = og["title"] || (ld?.name as string) || null;
  if (name) {
    name = decodeHtml(name)
      .replace(/ - Airbnb$/, "").replace(/ on Airbnb$/, "").replace(/ \| Airbnb$/, "").trim();
  }
  if (!name) name = `Airbnb Listing ${listingId}`;

  // Description
  let description: string | null = og["description"] || (ld?.description as string) || null;
  if (description) description = decodeHtml(description).slice(0, 2000);

  // Photos: clean URLs (strip query params + decode HTML entities)
  const cleanPhoto = (u: string) => decodeHtml(u.split("?")[0]);
  const finalPhotos = photos.length > 0
    ? photos.map(cleanPhoto).filter(Boolean)
    : (og["image"] ? [cleanPhoto(og["image"])] : []);

  // Build import report
  const importedFields: string[] = ["listing_id", "listing_url"];
  const failedFields: string[] = [];

  if (name && !name.startsWith("Airbnb Listing ")) importedFields.push("title"); else failedFields.push("title");
  if (description) importedFields.push("description"); else failedFields.push("description");
  if (finalPhotos.length > 0) importedFields.push("photos"); else failedFields.push("photos");
  if (amenities.length > 0) importedFields.push("amenities"); else failedFields.push("amenities");
  if (baseNightlyPrice) importedFields.push("base_nightly_price"); else failedFields.push("base_nightly_price");
  if (bedrooms != null) importedFields.push("bedrooms"); else failedFields.push("bedrooms");
  if (bathrooms != null) importedFields.push("bathrooms"); else failedFields.push("bathrooms");
  if (guestCapacity != null) importedFields.push("guest_capacity"); else failedFields.push("guest_capacity");
  if (location) importedFields.push("location"); else failedFields.push("location");

  if (finalPhotos.length === 0) {
    errors.push("Photos could not be imported. Airbnb's CDN requires a logged-in session to serve listing photos. Upload photos manually after import.");
  }
  if (!baseNightlyPrice) {
    errors.push("Base nightly price was not detected from the listing page. Set it manually in Pricing settings.");
  }
  if (!description) {
    errors.push("Listing description could not be extracted. Airbnb may have changed their page format.");
  }
  if (!bedrooms && !bathrooms) {
    errors.push("Room counts (beds/baths) could not be extracted. Update them manually in property settings.");
  }

  // Determine overall import status
  let importStatus: ImportReport["importStatus"];
  const coreFields = ["title", "description", "photos"];
  const missingCore = coreFields.filter(f => failedFields.includes(f)).length;
  if (fetchError && !html) {
    importStatus = "failed_import";
  } else if (missingCore === 0) {
    importStatus = "imported_successfully";
  } else {
    importStatus = "partially_imported";
  }

  const report: ImportReport = {
    photosImported: finalPhotos.length > 0,
    pricesImported: !!baseNightlyPrice,
    amenitiesImported: amenities.length > 0,
    calendarConnected: false,
    bookingsImported: false,
    importedFields,
    failedFields,
    errors,
    importStatus,
  };

  // Log import attempt
  try {
    await db.insert(importLogsTable).values({
      listingUrl: url,
      listingId,
      status: importStatus,
      importedFields: JSON.stringify(importedFields),
      failedFields: JSON.stringify(failedFields),
      errorMessage: errors.length > 0 ? errors.join(" | ") : null,
      photosImported: finalPhotos.length > 0 ? "yes" : "no",
      bookingsImported: "no",
      pricesImported: baseNightlyPrice ? "yes" : "no",
      amenitiesImported: amenities.length > 0 ? "yes" : "no",
      calendarConnected: detectedIcalUrl ? "yes" : "no",
    });
  } catch { /* non-fatal */ }

  const data = {
    listingId,
    name: name!,
    location: location || "Dubai, United Arab Emirates",
    area: area || "",
    city: city || "",
    country: country || "United Arab Emirates",
    building: "",
    description: description || "",
    photos: finalPhotos,
    amenities,
    bedrooms: bedrooms || 0,
    bathrooms: bathrooms || 0,
    guestCapacity: guestCapacity || 0,
    bedroomType: bedrooms ? `${bedrooms}BR` : "",
    listingUrl: `https://www.airbnb.com/rooms/${listingId}`,
    baseNightlyPrice: baseNightlyPrice || null,
    houseRules: null,
    propertyType: null,
    airbnbIcalUrl: detectedIcalUrl || null,
  };

  res.json({ success: true, data, report });
});

router.get("/airbnb/import-logs", async (req, res) => {
  try {
    const { db: dbInstance, importLogsTable: logsTable } = await import("@workspace/db");
    const logs = await dbInstance
      .select()
      .from(logsTable)
      .orderBy(logsTable.attemptedAt);
    res.json(logs.map(l => ({ ...l, attemptedAt: l.attemptedAt.toISOString() })));
  } catch {
    res.json([]);
  }
});

// POST /api/airbnb/resync/:propertyId — manual iCal resync
router.post("/airbnb/resync/:propertyId", async (req, res) => {
  const propertyId = parseInt(req.params.propertyId);
  if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });

  const [property] = await db
    .select({ airbnbIcalUrl: propertiesTable.airbnbIcalUrl, bookingComIcalUrl: propertiesTable.bookingComIcalUrl })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId));

  if (!property) return res.status(404).json({ error: "Property not found" });

  const results: { platform: string; result: any }[] = [];

  if (property.airbnbIcalUrl) {
    const result = await syncPropertyIcal(propertyId, "airbnb");
    results.push({ platform: "airbnb", result });
  }
  if (property.bookingComIcalUrl) {
    const result = await syncPropertyIcal(propertyId, "booking_com");
    results.push({ platform: "booking_com", result });
  }

  if (results.length === 0) {
    return res.status(400).json({ error: "No iCal URLs configured for this property. Add an Airbnb iCal URL first." });
  }

  res.json({ success: true, results });
});

export default router;
