import { Router } from "express";
import OpenAI from "openai";
import Replicate from "replicate";
import { db, yallareadyAnalysesTable, yallareadyTrialUsersTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router = Router();

const openai = process.env["OPENAI_API_KEY"]
  ? new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] })
  : null;

const replicate = process.env["REPLICATE_API_TOKEN"]
  ? new Replicate({ auth: process.env["REPLICATE_API_TOKEN"] })
  : null;

// Real per-photo pixel analysis using sharp — used when GPT-4o Vision is unavailable
async function analyseImageBase64WithSharp(base64: string): Promise<PhotoMetrics> {
  const sharp = (await import("sharp")).default;
  const buffer = Buffer.from(base64, "base64");
  const { data, info } = await sharp(buffer)
    .resize(200, 200, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ch = info.channels;
  const count = info.width * info.height;
  let totalR = 0, totalG = 0, totalB = 0, greenPx = 0, neutralPx = 0;
  const brightnessVals: number[] = [];

  for (let i = 0; i < data.length; i += ch) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    totalR += r; totalG += g; totalB += b;
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    brightnessVals.push(brightness);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (g > r * 1.15 && g > b * 1.15 && g > 55 && sat > 0.15) greenPx++;
    if (sat < 0.18 && brightness > 90) neutralPx++;
  }

  const avgR = totalR / count, avgG = totalG / count, avgB = totalB / count;
  const avgBrightness = (0.299 * avgR + 0.587 * avgG + 0.114 * avgB) / 255 * 100;
  const warmth = Math.max(0, Math.min(100, ((avgR * 1.2 + avgG * 0.4 - avgB * 1.1) + 200) / 4));
  const maxC = Math.max(avgR, avgG, avgB), minC = Math.min(avgR, avgG, avgB);
  const saturation = maxC === 0 ? 0 : ((maxC - minC) / maxC) * 100;
  const avgBr = brightnessVals.reduce((s, v) => s + v, 0) / count;
  const variance = brightnessVals.reduce((s, v) => s + Math.pow(v - avgBr, 2), 0) / count;
  const complexity = Math.min(100, Math.sqrt(variance) * 2.8);

  return {
    brightness: Math.round(avgBrightness),
    warmth: Math.round(warmth),
    saturation: Math.round(saturation),
    complexity: Math.round(complexity),
    greenPresence: Math.round((greenPx / count) * 100),
    neutralRatio: Math.round((neutralPx / count) * 100),
  };
}

const BUDGET_PROMPTS: Record<string, string> = {
  "budget-refresh": "Refresh room using low-cost improvements only. Add cushions, throws, plants, lighting upgrades, bedding, wall decor. Keep everything realistic and affordable.",
  "standard-upgrade": "Upgrade room for Airbnb performance. Add hotel bedding, curtains, better furniture styling, artwork, improved lighting, accessories and guest-ready design.",
  "premium-look": "Create a premium holiday home appearance. Include smart lock, coffee station, feature wall, luxury bedding and professional Airbnb styling.",
  "luxury": "Create a luxury Airbnb interior suitable for Dubai holiday homes. Add premium furnishings, designer lighting, feature decor, luxury textiles and high-end styling.",
};

type CostItem = { name: string; cost: number };

const COST_BREAKDOWN_BY_ROOM: Record<string, Record<string, CostItem[]>> = {
  "bedroom": {
    "budget-refresh": [
      { name: "Hotel Bedding Set", cost: 350 },
      { name: "Pillows (x4)", cost: 120 },
      { name: "Throw Blanket", cost: 89 },
      { name: "Bedside Lamps (x2)", cost: 220 },
      { name: "Curtains", cost: 250 },
      { name: "Wall Art Print", cost: 180 },
    ],
    "standard-upgrade": [
      { name: "Luxury Hotel Bedding Set", cost: 650 },
      { name: "Designer Pillows (x6)", cost: 280 },
      { name: "Blackout Curtains", cost: 450 },
      { name: "Bedside Lamps (x2)", cost: 480 },
      { name: "Bedroom Rug", cost: 420 },
      { name: "Framed Wall Art (x2)", cost: 380 },
    ],
    "premium-look": [
      { name: "5-Star Hotel Bedding Package", cost: 1200 },
      { name: "Designer Curtains", cost: 850 },
      { name: "Luxury Bedside Lamps (x2)", cost: 920 },
      { name: "Statement Rug", cost: 1100 },
      { name: "Gallery Wall (3 prints)", cost: 750 },
      { name: "Smart Lock", cost: 1200 },
    ],
    "luxury": [
      { name: "Bespoke Bedding Package", cost: 3500 },
      { name: "Designer Curtains & Sheers", cost: 2200 },
      { name: "Designer Lamps (x2)", cost: 2800 },
      { name: "Luxury Rug", cost: 3200 },
      { name: "Custom Gallery Wall", cost: 1800 },
      { name: "Smart Home System", cost: 3200 },
    ],
  },
  "living-room": {
    "budget-refresh": [
      { name: "Cushions & Throws", cost: 180 },
      { name: "Indoor Plants (x3)", cost: 120 },
      { name: "Smart Bulbs (x4)", cost: 160 },
      { name: "Wall Decor Print", cost: 200 },
      { name: "Coffee Table Tray & Styling", cost: 150 },
      { name: "Fragrance Diffuser", cost: 89 },
    ],
    "standard-upgrade": [
      { name: "Sofa Throw & Cushion Set", cost: 480 },
      { name: "Curtains", cost: 450 },
      { name: "Artwork Set (x3)", cost: 380 },
      { name: "Floor Lamp", cost: 320 },
      { name: "Coffee Table", cost: 890 },
      { name: "Area Rug", cost: 560 },
    ],
    "premium-look": [
      { name: "Designer Sofa", cost: 4800 },
      { name: "Coffee Station Setup", cost: 850 },
      { name: "Gallery Wall (5 pieces)", cost: 750 },
      { name: "Luxury Curtains", cost: 950 },
      { name: "Smart Lock", cost: 1200 },
      { name: "Designer Rug", cost: 1100 },
    ],
    "luxury": [
      { name: "Bespoke Furniture Package", cost: 8500 },
      { name: "Designer Lighting Set", cost: 3200 },
      { name: "Custom Gallery Wall", cost: 2800 },
      { name: "Smart Home System", cost: 3200 },
      { name: "Professional Staging", cost: 4500 },
      { name: "Luxury Textile Package", cost: 1500 },
    ],
  },
  "kitchen": {
    "budget-refresh": [
      { name: "Kitchen Accessories Set", cost: 180 },
      { name: "Herb Garden Kit", cost: 89 },
      { name: "Tea & Coffee Station", cost: 200 },
      { name: "Pendant Light", cost: 280 },
      { name: "Wall Art", cost: 150 },
      { name: "Stylish Dish Rack", cost: 120 },
    ],
    "standard-upgrade": [
      { name: "Coffee Machine", cost: 650 },
      { name: "Under-Cabinet LED Lighting", cost: 320 },
      { name: "Premium Cookware Set", cost: 580 },
      { name: "Bar Stools (x2)", cost: 440 },
      { name: "Kitchen Accessories Kit", cost: 260 },
      { name: "Backsplash Tiles", cost: 480 },
    ],
    "premium-look": [
      { name: "Nespresso Machine", cost: 799 },
      { name: "Premium Appliance Set", cost: 2800 },
      { name: "Designer Pendant Lights", cost: 950 },
      { name: "Kitchen Island", cost: 2200 },
      { name: "Smart Lock", cost: 1200 },
      { name: "Premium Backsplash", cost: 1800 },
    ],
    "luxury": [
      { name: "High-End Appliance Package", cost: 8500 },
      { name: "Custom Kitchen Island", cost: 4500 },
      { name: "Designer Lighting", cost: 2800 },
      { name: "Smart Home Integration", cost: 3200 },
      { name: "Premium Bar Setup", cost: 2500 },
      { name: "Professional Staging", cost: 2000 },
    ],
  },
  "bathroom": {
    "budget-refresh": [
      { name: "Luxury Towel Set (6pcs)", cost: 280 },
      { name: "Marble Accessories Set", cost: 220 },
      { name: "Shower Caddy", cost: 89 },
      { name: "Backlit Mirror", cost: 350 },
      { name: "Fragrance Diffuser", cost: 89 },
      { name: "Indoor Plant", cost: 60 },
    ],
    "standard-upgrade": [
      { name: "Premium Towels & Robes", cost: 580 },
      { name: "Marble Vanity Accessories", cost: 450 },
      { name: "Backlit LED Mirror", cost: 680 },
      { name: "Rainfall Showerhead", cost: 480 },
      { name: "Heated Towel Rail", cost: 590 },
      { name: "Hotel Amenities Kit", cost: 180 },
    ],
    "premium-look": [
      { name: "Freestanding Bathtub", cost: 3200 },
      { name: "Premium Shower System", cost: 2800 },
      { name: "Designer Mirror", cost: 1200 },
      { name: "Luxury Towels & Robes", cost: 950 },
      { name: "Heated Floor System", cost: 2400 },
      { name: "Smart Lighting", cost: 850 },
    ],
    "luxury": [
      { name: "Spa Bathtub Package", cost: 8500 },
      { name: "Smart Shower System", cost: 5500 },
      { name: "Bespoke Vanity", cost: 4200 },
      { name: "Underfloor Heating", cost: 3200 },
      { name: "Designer Accessories Set", cost: 2800 },
      { name: "Professional Staging", cost: 2000 },
    ],
  },
  "balcony": {
    "budget-refresh": [
      { name: "Outdoor Cushion Set", cost: 280 },
      { name: "Potted Plants (x3)", cost: 150 },
      { name: "String Lights", cost: 120 },
      { name: "Outdoor Mat", cost: 180 },
      { name: "Small Side Table", cost: 220 },
      { name: "Scented Candles", cost: 89 },
    ],
    "standard-upgrade": [
      { name: "Outdoor Furniture Set", cost: 1200 },
      { name: "Shade Sail", cost: 580 },
      { name: "Outdoor Lighting", cost: 380 },
      { name: "Plant Pots (x5)", cost: 280 },
      { name: "Outdoor Rug", cost: 320 },
      { name: "Artificial Turf Panel", cost: 450 },
    ],
    "premium-look": [
      { name: "Premium Outdoor Sofa Set", cost: 3800 },
      { name: "Pergola", cost: 4500 },
      { name: "Outdoor Lighting System", cost: 850 },
      { name: "Designer Plant Wall", cost: 1200 },
      { name: "Premium Rug", cost: 650 },
      { name: "Smart Lock", cost: 1200 },
    ],
    "luxury": [
      { name: "Bespoke Outdoor Furniture", cost: 12000 },
      { name: "Custom Pergola", cost: 8500 },
      { name: "Outdoor Kitchen", cost: 6500 },
      { name: "Smart Irrigation System", cost: 3200 },
      { name: "Designer Lighting", cost: 2800 },
      { name: "Professional Landscaping", cost: 4500 },
    ],
  },
};

function getRoomCostBreakdown(roomType: string, budgetTier: string): CostItem[] {
  const roomKey = COST_BREAKDOWN_BY_ROOM[roomType] ? roomType : "living-room";
  const tierKey = (COST_BREAKDOWN_BY_ROOM[roomKey] as Record<string, CostItem[]>)[budgetTier]
    ? budgetTier
    : "standard-upgrade";
  return (COST_BREAKDOWN_BY_ROOM[roomKey] as Record<string, CostItem[]>)[tierKey];
}

export interface PhotoMetrics {
  brightness: number;
  warmth: number;
  saturation: number;
  complexity: number;
  greenPresence: number;
  neutralRatio: number;
}

export interface DubaiProduct {
  id: string;
  name: string;
  store: string;
  storeUrl: string;
  priceMin: number;
  priceMax: number;
  currency: string;
  category: string;
  roomTypes: string[];
  priority: "must-have" | "nice-to-have";
  impactScore: number;
  whyItHelps: string;
  budgetTier: "budget" | "mid" | "premium";
  imageKeyword: string;
}

export const DUBAI_PRODUCT_DATABASE: DubaiProduct[] = [
  {
    id: "p001",
    name: "SYMFONISK Picture Frame Wi-Fi Speaker",
    store: "IKEA UAE",
    storeUrl: "https://www.ikea.com/ae/en/",
    priceMin: 299,
    priceMax: 349,
    currency: "AED",
    category: "Decor & Audio",
    roomTypes: ["living-room", "bedroom", "studio"],
    priority: "must-have",
    impactScore: 9,
    whyItHelps: "Adds both art and ambient sound for a 5-star hotel feel",
    budgetTier: "mid",
    imageKeyword: "speaker wall art frame",
  },
  {
    id: "p002",
    name: "KALLAX Shelf Unit (White, 4 Cube)",
    store: "IKEA UAE",
    storeUrl: "https://www.ikea.com/ae/en/",
    priceMin: 199,
    priceMax: 249,
    currency: "AED",
    category: "Storage",
    roomTypes: ["living-room", "bedroom", "studio", "full-apartment"],
    priority: "must-have",
    impactScore: 8,
    whyItHelps: "Organised storage raises readiness score and photos look cleaner",
    budgetTier: "budget",
    imageKeyword: "white shelf unit storage cubes",
  },
  {
    id: "p003",
    name: "FEJKA Artificial Potted Plant Set (3pcs)",
    store: "IKEA UAE",
    storeUrl: "https://www.ikea.com/ae/en/",
    priceMin: 59,
    priceMax: 89,
    currency: "AED",
    category: "Greenery",
    roomTypes: ["living-room", "bedroom", "bathroom", "balcony", "studio", "full-apartment"],
    priority: "must-have",
    impactScore: 9,
    whyItHelps: "Greenery adds life and warmth — top-performing detail in Airbnb listing photos",
    budgetTier: "budget",
    imageKeyword: "artificial potted plants home decor",
  },
  {
    id: "p004",
    name: "VINDSTYRKA Air Quality Sensor",
    store: "IKEA UAE",
    storeUrl: "https://www.ikea.com/ae/en/",
    priceMin: 129,
    priceMax: 149,
    currency: "AED",
    category: "Smart Home",
    roomTypes: ["living-room", "bedroom", "studio", "full-apartment"],
    priority: "nice-to-have",
    impactScore: 7,
    whyItHelps: "Signals guest comfort and care — a detail guests notice and mention in reviews",
    budgetTier: "mid",
    imageKeyword: "air quality monitor smart home",
  },
  {
    id: "p005",
    name: "TRADFRI Smart LED Bulb Kit (4-pack)",
    store: "IKEA UAE",
    storeUrl: "https://www.ikea.com/ae/en/",
    priceMin: 149,
    priceMax: 199,
    currency: "AED",
    category: "Lighting",
    roomTypes: ["living-room", "bedroom", "kitchen", "studio", "full-apartment"],
    priority: "must-have",
    impactScore: 10,
    whyItHelps: "Warm dimmable lighting is the #1 factor in Airbnb photo ratings",
    budgetTier: "budget",
    imageKeyword: "smart LED bulbs warm lighting",
  },
  {
    id: "p006",
    name: "Egyptian Cotton Hotel Towel Set (6pcs)",
    store: "Home Centre",
    storeUrl: "https://www.homecentre.com/ae/en/",
    priceMin: 199,
    priceMax: 279,
    currency: "AED",
    category: "Linen",
    roomTypes: ["bathroom", "bedroom", "full-apartment"],
    priority: "must-have",
    impactScore: 9,
    whyItHelps: "Fluffy white towels are a hotel staple and a direct driver of 5-star reviews",
    budgetTier: "budget",
    imageKeyword: "white hotel towel set bathroom",
  },
  {
    id: "p007",
    name: "Bamboo Floating Wall Shelves (Set of 3)",
    store: "Home Centre",
    storeUrl: "https://www.homecentre.com/ae/en/",
    priceMin: 149,
    priceMax: 199,
    currency: "AED",
    category: "Storage & Decor",
    roomTypes: ["living-room", "bedroom", "bathroom", "kitchen", "balcony"],
    priority: "nice-to-have",
    impactScore: 7,
    whyItHelps: "Vertical storage frees floor space and creates visual interest in photos",
    budgetTier: "budget",
    imageKeyword: "bamboo floating wall shelves",
  },
  {
    id: "p008",
    name: "Premium Bedding Set — Microfiber 1000TC (King)",
    store: "Home Centre",
    storeUrl: "https://www.homecentre.com/ae/en/",
    priceMin: 299,
    priceMax: 399,
    currency: "AED",
    category: "Linen",
    roomTypes: ["bedroom", "studio", "full-apartment"],
    priority: "must-have",
    impactScore: 10,
    whyItHelps: "Crisp white hotel bedding is the single highest-ROI upgrade for any bedroom",
    budgetTier: "mid",
    imageKeyword: "white hotel bedding set luxury",
  },
  {
    id: "p009",
    name: "Scented Reed Diffuser Set (Oud & Amber)",
    store: "Home Centre",
    storeUrl: "https://www.homecentre.com/ae/en/",
    priceMin: 89,
    priceMax: 129,
    currency: "AED",
    category: "Fragrance",
    roomTypes: ["living-room", "bedroom", "bathroom", "studio", "full-apartment"],
    priority: "must-have",
    impactScore: 8,
    whyItHelps: "Scent triggers memory — a signature fragrance lifts guest reviews significantly",
    budgetTier: "budget",
    imageKeyword: "reed diffuser oud amber luxury",
  },
  {
    id: "p010",
    name: "Smart Keypad Door Lock (Bluetooth + App)",
    store: "Amazon UAE",
    storeUrl: "https://www.amazon.ae/",
    priceMin: 450,
    priceMax: 650,
    currency: "AED",
    category: "Smart Access",
    roomTypes: ["full-apartment", "studio", "living-room"],
    priority: "must-have",
    impactScore: 10,
    whyItHelps: "Keyless entry is now a baseline expectation for Airbnb guests in Dubai",
    budgetTier: "mid",
    imageKeyword: "smart keypad door lock apartment",
  },
  {
    id: "p011",
    name: "Portable Bluetooth Shower Speaker (Waterproof)",
    store: "Amazon UAE",
    storeUrl: "https://www.amazon.ae/",
    priceMin: 79,
    priceMax: 149,
    currency: "AED",
    category: "Amenity",
    roomTypes: ["bathroom", "full-apartment", "studio"],
    priority: "nice-to-have",
    impactScore: 6,
    whyItHelps: "Unexpected amenity guests love to mention in reviews — high surprise factor",
    budgetTier: "budget",
    imageKeyword: "waterproof bluetooth shower speaker",
  },
  {
    id: "p012",
    name: "Ring Video Doorbell (WiFi, Battery)",
    store: "Amazon UAE",
    storeUrl: "https://www.amazon.ae/",
    priceMin: 349,
    priceMax: 499,
    currency: "AED",
    category: "Security",
    roomTypes: ["full-apartment", "studio"],
    priority: "nice-to-have",
    impactScore: 7,
    whyItHelps: "Security cameras at entry points increase host rating and guest trust",
    budgetTier: "mid",
    imageKeyword: "ring video doorbell smart security",
  },
  {
    id: "p013",
    name: "Acacia Wood Decorative Tray Set",
    store: "Pottery Barn UAE",
    storeUrl: "https://www.potterybarn.ae/",
    priceMin: 199,
    priceMax: 299,
    currency: "AED",
    category: "Decor",
    roomTypes: ["living-room", "bedroom", "bathroom", "kitchen"],
    priority: "nice-to-have",
    impactScore: 7,
    whyItHelps: "Styled trays create intentional, photogenic vignettes on surfaces",
    budgetTier: "mid",
    imageKeyword: "acacia wood tray set home decor",
  },
  {
    id: "p014",
    name: "Linen Throw Blanket (Neutral, 130x170cm)",
    store: "Pottery Barn UAE",
    storeUrl: "https://www.potterybarn.ae/",
    priceMin: 249,
    priceMax: 399,
    currency: "AED",
    category: "Textile",
    roomTypes: ["living-room", "bedroom", "balcony"],
    priority: "must-have",
    impactScore: 8,
    whyItHelps: "Textured throws add warmth and depth to flat furniture in listing photos",
    budgetTier: "mid",
    imageKeyword: "linen throw blanket sofa neutral",
  },
  {
    id: "p015",
    name: "Marble Effect Bath Accessory Set (5pcs)",
    store: "Pottery Barn UAE",
    storeUrl: "https://www.potterybarn.ae/",
    priceMin: 299,
    priceMax: 449,
    currency: "AED",
    category: "Bathroom Decor",
    roomTypes: ["bathroom", "full-apartment"],
    priority: "nice-to-have",
    impactScore: 8,
    whyItHelps: "Matching accessories transform a standard bathroom into a spa-like experience",
    budgetTier: "mid",
    imageKeyword: "marble bathroom accessories set luxury",
  },
  {
    id: "p016",
    name: "Professional Ring Light with Tripod (18\")",
    store: "Amazon UAE",
    storeUrl: "https://www.amazon.ae/",
    priceMin: 149,
    priceMax: 249,
    currency: "AED",
    category: "Photography",
    roomTypes: ["living-room", "bedroom", "studio", "full-apartment"],
    priority: "must-have",
    impactScore: 9,
    whyItHelps: "Proper listing photos increase bookings by 40% — lighting is the #1 factor",
    budgetTier: "budget",
    imageKeyword: "ring light photography tripod",
  },
  {
    id: "p017",
    name: "Balcony Privacy Shade Screen (2x3m)",
    store: "Amazon UAE",
    storeUrl: "https://www.amazon.ae/",
    priceMin: 129,
    priceMax: 199,
    currency: "AED",
    category: "Outdoor",
    roomTypes: ["balcony"],
    priority: "must-have",
    impactScore: 8,
    whyItHelps: "Privacy screens turn a bare balcony into a usable outdoor space guests love",
    budgetTier: "budget",
    imageKeyword: "balcony privacy shade screen outdoor",
  },
  {
    id: "p018",
    name: "Foldable Outdoor Bistro Set (Table + 2 Chairs)",
    store: "IKEA UAE",
    storeUrl: "https://www.ikea.com/ae/en/",
    priceMin: 349,
    priceMax: 499,
    currency: "AED",
    category: "Outdoor Furniture",
    roomTypes: ["balcony"],
    priority: "must-have",
    impactScore: 9,
    whyItHelps: "A styled balcony adds perceived value and is one of the most photographed spaces",
    budgetTier: "mid",
    imageKeyword: "bistro set balcony outdoor table chairs",
  },
  {
    id: "p019",
    name: "Under-Cabinet LED Strip Lights (3m, Warm White)",
    store: "Home Centre",
    storeUrl: "https://www.homecentre.com/ae/en/",
    priceMin: 89,
    priceMax: 149,
    currency: "AED",
    category: "Lighting",
    roomTypes: ["kitchen", "studio", "full-apartment"],
    priority: "nice-to-have",
    impactScore: 7,
    whyItHelps: "Under-cabinet lighting makes kitchens look modern and professionally equipped",
    budgetTier: "budget",
    imageKeyword: "under cabinet LED strip kitchen warm",
  },
  {
    id: "p020",
    name: "Stainless Steel Kitchen Organiser Set",
    store: "Home Centre",
    storeUrl: "https://www.homecentre.com/ae/en/",
    priceMin: 149,
    priceMax: 229,
    currency: "AED",
    category: "Kitchen",
    roomTypes: ["kitchen", "full-apartment"],
    priority: "must-have",
    impactScore: 8,
    whyItHelps: "A well-organised kitchen is the #2 most reviewed feature after bedding",
    budgetTier: "budget",
    imageKeyword: "stainless steel kitchen organiser set",
  },
  {
    id: "p021",
    name: "Nespresso Vertuo Coffee Machine",
    store: "Amazon UAE",
    storeUrl: "https://www.amazon.ae/",
    priceMin: 499,
    priceMax: 799,
    currency: "AED",
    category: "Appliance",
    roomTypes: ["kitchen", "studio", "full-apartment"],
    priority: "nice-to-have",
    impactScore: 9,
    whyItHelps: "Premium coffee machines are mentioned in over 60% of 5-star Dubai Airbnb reviews",
    budgetTier: "premium",
    imageKeyword: "nespresso coffee machine kitchen",
  },
  {
    id: "p022",
    name: "Velvet Blackout Curtains (Set of 2, 2.4m Drop)",
    store: "Home Centre",
    storeUrl: "https://www.homecentre.com/ae/en/",
    priceMin: 299,
    priceMax: 449,
    currency: "AED",
    category: "Window Treatment",
    roomTypes: ["bedroom", "living-room", "studio", "full-apartment"],
    priority: "must-have",
    impactScore: 9,
    whyItHelps: "Blackout curtains are critical for guest sleep quality in Dubai's sunny climate",
    budgetTier: "mid",
    imageKeyword: "velvet blackout curtains bedroom luxury",
  },
];

interface VisionAnalysis {
  detected: string[];
  roomCondition: string;
  scores: {
    firstImpression: number;
    stylingDecor: number;
    lightingQuality: number;
    guestComfort: number;
    amenities: number;
    photoReadiness: number;
  };
  issues: Array<{ title: string; severity: "high" | "medium" | "low"; description: string }>;
  improvements: Array<{ title: string; description: string; estimatedCost: number; impact: string }>;
}

async function analyseWithGPT4oVision(
  photoBase64List: string[],
  roomType: string,
  budget: number
): Promise<VisionAnalysis> {
  const roomLabel = roomType.replace(/-/g, " ");

  const systemPrompt = `You are an expert Airbnb property consultant specialising in Dubai short-term rentals. 
You analyse room photos and provide specific, actionable feedback to help owners maximise their listing performance and rental yield.
Your analysis must reference what you actually see in the photos — be specific about furniture, colours, lighting, decor elements, and issues you can observe.
Always respond with valid JSON only, no markdown or extra text.`;

  const userPrompt = `Analyse ${photoBase64List.length > 1 ? "these " + photoBase64List.length + " photos" : "this photo"} of a ${roomLabel} in a Dubai Airbnb property.

The owner has a budget of AED ${budget} to improve the space.

Score the room across 6 categories (each 0–100, where 100 is perfect 5-star Dubai Airbnb standard):
1. firstImpression — overall wow factor when a guest first sees the listing photo
2. stylingDecor — quality and intentionality of decor, props, and styling
3. lightingQuality — warmth, brightness, layering, and photogenicity of the lighting
4. guestComfort — how comfortable and welcoming the space looks for guests
5. amenities — visible appliances, storage, and guest-focused features
6. photoReadiness — how ready this space is for professional listing photography

Also identify:
- Up to 6 specific things you can observe in the photos (detected[]) — name actual elements you see
- The overall room condition: "excellent", "good-base", "good-potential", or "needs-work"
- Up to 5 specific issues with title, severity (high/medium/low), and a description that references what you actually see
- Up to 5 improvement actions with title, description, estimatedCost (in AED, within the total budget of ${budget}), and impact

Respond ONLY with this JSON structure:
{
  "detected": ["string", ...],
  "roomCondition": "good-potential",
  "scores": {
    "firstImpression": 55,
    "stylingDecor": 45,
    "lightingQuality": 60,
    "guestComfort": 65,
    "amenities": 50,
    "photoReadiness": 40
  },
  "issues": [
    { "title": "string", "severity": "high", "description": "string" }
  ],
  "improvements": [
    { "title": "string", "description": "string", "estimatedCost": 300, "impact": "string" }
  ]
}`;

  const imageContent: OpenAI.Chat.ChatCompletionContentPart[] = photoBase64List
    .slice(0, 4)
    .map((b64) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:image/jpeg;base64,${b64}`,
        detail: "low" as const,
      },
    }));

  const response = await openai!.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1500,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [{ type: "text", text: userPrompt }, ...imageContent],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("GPT-4o returned no valid JSON");
  return JSON.parse(jsonMatch[0]) as VisionAnalysis;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function heuristicAnalysis(
  photoCount: number,
  roomType: string,
  metrics: PhotoMetrics,
  budget: number
): VisionAnalysis {
  const detected: string[] = [];

  if (metrics.brightness > 58) detected.push("Good natural light levels detected");
  else if (metrics.brightness > 38) detected.push("Moderate ambient light — some dark corners visible");
  else detected.push("Low light levels detected — room appears dim");

  if (metrics.warmth > 58) detected.push("Warm colour temperature — inviting atmosphere");
  else if (metrics.warmth < 38) detected.push("Cool, clinical colour temperature detected");
  else detected.push("Neutral colour tone — styling could add more warmth");

  if (metrics.greenPresence > 20) detected.push("Some greenery present — adds life to the space");
  else detected.push("No significant plant or greenery elements found");

  if (metrics.complexity > 65) detected.push("High visual complexity — surfaces appear cluttered");
  else if (metrics.complexity < 22) detected.push("Sparse styling detected — surfaces look bare");
  else detected.push("Moderate styling density — good base to build on");

  if (metrics.saturation > 45) detected.push("Colourful palette — may need neutral anchoring for photos");
  else if (metrics.saturation < 18) detected.push("Very muted palette — lacks visual energy in listing photos");
  else detected.push("Balanced colour palette identified");

  if (photoCount > 3) detected.push(`${photoCount} photos analysed for comprehensive coverage`);

  const overallScore =
    metrics.brightness * 0.3 +
    metrics.warmth * 0.25 +
    (100 - Math.abs(metrics.complexity - 45)) * 0.2 +
    metrics.neutralRatio * 0.15 +
    metrics.greenPresence * 0.1;

  let roomCondition: string;
  if (overallScore > 65) roomCondition = "good-base";
  else if (overallScore > 45) roomCondition = "good-potential";
  else roomCondition = "needs-work";

  const lightingScore = clamp(20 + metrics.brightness * 0.5 + metrics.warmth * 0.2 - (metrics.brightness < 35 ? 15 : 0), 18, 74);
  const stylingScore = clamp(15 + metrics.saturation * 0.3 + (metrics.complexity > 20 && metrics.complexity < 65 ? 20 : 0) + metrics.greenPresence * 0.2, 15, 72);
  const photoScore = clamp(10 + metrics.brightness * 0.4 + metrics.neutralRatio * 0.25 - (metrics.complexity > 65 ? 20 : 0) - (metrics.brightness < 35 ? 15 : 0), 12, 74);
  const comfortScore = clamp(20 + metrics.warmth * 0.35 + metrics.greenPresence * 0.15 + metrics.brightness * 0.2, 18, 76);
  const impressionScore = clamp((lightingScore + stylingScore + photoScore + comfortScore) / 4 + (metrics.neutralRatio > 50 ? 5 : 0), 15, 74);
  const amenitiesScore = clamp(30 + (roomType === "kitchen" ? 10 : 0) + (roomType === "bathroom" ? 8 : 0) + metrics.complexity * 0.1, 20, 70);

  const issues: Array<{ title: string; severity: "high" | "medium" | "low"; description: string }> = [];
  if (metrics.brightness < 38) {
    issues.push({ title: "Critically Low Lighting", severity: "high", description: "Very dark conditions detected. Poor lighting is the #1 reason guests skip a listing — it reduces booking conversion by up to 55%." });
  } else if (metrics.brightness < 55) {
    issues.push({ title: "Insufficient Lighting", severity: "high", description: "Room brightness is below the threshold for appealing listing photos. Warm-white layered lighting will transform the atmosphere." });
  }
  if (metrics.warmth < 38) {
    issues.push({ title: "Cold, Clinical Atmosphere", severity: "high", description: "Cool blue-white tones detected. Guests associate warm tones with comfort — warm lighting and textiles will significantly lift appeal." });
  }
  if (metrics.greenPresence < 15) {
    issues.push({ title: "No Greenery or Natural Elements", severity: "medium", description: "No plants or botanical elements detected. Greenery is consistently the highest-ROI styling addition." });
  }
  if (metrics.complexity > 68) {
    issues.push({ title: "Visual Clutter Detected", severity: "high", description: "High visual complexity — the space looks cluttered. Decluttering surfaces dramatically improves listing photo performance." });
  } else if (metrics.complexity < 20) {
    issues.push({ title: "Sparse and Unstyled Surfaces", severity: "medium", description: "Very few decorative elements detected. Bare walls and empty surfaces make a space feel impersonal." });
  }
  if (issues.length < 3) {
    issues.push({ title: "Fragrance & Ambience Absent", severity: "low", description: "No visible scent diffuser. A signature scent is one of the most frequently mentioned positives in 5-star Dubai reviews." });
  }

  const improvements = [
    {
      title: metrics.brightness < 55 ? "Smart Lighting Overhaul" : "Lighting Layer Enhancement",
      description: "Replace cool overhead bulbs with warm smart LEDs (2700K). Add a floor or table lamp to create depth and eliminate flat shadows.",
      estimatedCost: Math.round(budget * 0.18),
      impact: "Transforms listing photos immediately — lighting is the single highest-impact change",
    },
    {
      title: "Greenery & Natural Elements",
      description: "Add 3–5 artificial plants in varying heights. Zero maintenance and highly photogenic.",
      estimatedCost: Math.round(budget * 0.07),
      impact: "Adds life and warmth that guests immediately feel",
    },
    {
      title: metrics.complexity > 65 ? "Declutter & Organise" : "Surface Vignette Styling",
      description: metrics.complexity > 65
        ? "Clear all visible surface clutter. Add storage baskets and a shelf unit to keep necessities out of sight."
        : "Style coffee table, shelves and bedside with curated trays, candles, and a few select objects.",
      estimatedCost: Math.round(budget * 0.11),
      impact: "Creates intentional, photogenic areas that stand out in search results",
    },
    {
      title: "Hotel-Quality Linen Upgrade",
      description: "Replace current bedding with crisp white hotel-grade sheets, plush pillows, and a textured throw.",
      estimatedCost: Math.round(budget * 0.2),
      impact: "The most commented-on guest upgrade — mentioned in 70% of 5-star Dubai Airbnb reviews",
    },
    {
      title: "Signature Fragrance Station",
      description: "Place a luxury reed diffuser at the entry and a lighter one in the bathroom. Choose Oud & Amber for a Dubai sensory identity.",
      estimatedCost: Math.round(budget * 0.05),
      impact: "Scent creates lasting emotional memory — guests mention it in reviews more than they realise",
    },
  ];

  return {
    detected,
    roomCondition,
    scores: {
      firstImpression: Math.round(impressionScore),
      stylingDecor: Math.round(stylingScore),
      lightingQuality: Math.round(lightingScore),
      guestComfort: Math.round(comfortScore),
      amenities: Math.round(amenitiesScore),
      photoReadiness: Math.round(photoScore),
    },
    issues,
    improvements,
  };
}

function buildScoringFromVision(vision: VisionAnalysis): {
  overall: { before: number; after: number };
  categories: Array<{ name: string; before: number; after: number }>;
} {
  const s = vision.scores;
  const categories = [
    { name: "First Impression", before: clamp(s.firstImpression, 10, 78), after: clamp(s.firstImpression + 28, 72, 98) },
    { name: "Styling & Decor", before: clamp(s.stylingDecor, 10, 78), after: clamp(s.stylingDecor + 35, 75, 98) },
    { name: "Lighting Quality", before: clamp(s.lightingQuality, 10, 78), after: clamp(s.lightingQuality + 30, 76, 98) },
    { name: "Guest Comfort", before: clamp(s.guestComfort, 10, 78), after: clamp(s.guestComfort + 25, 72, 96) },
    { name: "Amenities", before: clamp(s.amenities, 10, 78), after: clamp(s.amenities + 22, 68, 94) },
    { name: "Photo Readiness", before: clamp(s.photoReadiness, 10, 78), after: clamp(s.photoReadiness + 32, 78, 98) },
  ];
  const overallBefore = Math.round(categories.reduce((sum, c) => sum + c.before, 0) / categories.length);
  const overallAfter = Math.round(categories.reduce((sum, c) => sum + c.after, 0) / categories.length);
  return { overall: { before: overallBefore, after: overallAfter }, categories };
}

function suggestDubaiProducts(
  roomType: string,
  budget: number,
  vision: VisionAnalysis
): DubaiProduct[] {
  const filtered = DUBAI_PRODUCT_DATABASE.filter(
    (p) => p.roomTypes.includes(roomType) || p.roomTypes.includes("full-apartment")
  );
  const budgetTier = budget <= 1500 ? "budget" : budget <= 3500 ? "mid" : "premium";
  const tierOrder =
    budgetTier === "budget" ? ["budget"] :
    budgetTier === "mid" ? ["budget", "mid"] :
    ["budget", "mid", "premium"];

  const lowerIssues = vision.issues.map(i => i.title.toLowerCase() + " " + i.description.toLowerCase()).join(" ");

  return filtered
    .filter((p) => tierOrder.includes(p.budgetTier))
    .map((p) => {
      let boost = 0;
      if (p.category === "Lighting" && lowerIssues.includes("light")) boost += 3;
      if (p.category === "Greenery" && lowerIssues.includes("green")) boost += 3;
      if (p.category === "Storage" && lowerIssues.includes("clutter")) boost += 2;
      if (p.category === "Textile" && (lowerIssues.includes("warm") || lowerIssues.includes("cold"))) boost += 2;
      if (p.category === "Linen" && (lowerIssues.includes("bed") || lowerIssues.includes("linen"))) boost += 2;
      if (p.category === "Photography" && vision.scores.photoReadiness < 50) boost += 2;
      return { ...p, impactScore: p.impactScore + boost };
    })
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 8)
    .map(({ impactScore: _boosted, ...p }) => {
      const original = DUBAI_PRODUCT_DATABASE.find(x => x.id === p.id)!;
      return original;
    });
}

function buildDayByDayPlan(
  vision: VisionAnalysis
): Array<{ day: number; title: string; tasks: string[] }> {
  const needsLighting = vision.scores.lightingQuality < 55;
  return [
    {
      day: 1,
      title: "Purchase Day",
      tasks: [
        "Visit IKEA UAE at Festival City or Jebel Ali — smart bulbs, plants, storage",
        "Stop at Home Centre for hotel-grade bedding and towel set",
        "Order smart lock and ring light from Amazon UAE (next-day delivery)",
        "Pick up reed diffuser and tray set at Pottery Barn UAE or online",
      ],
    },
    {
      day: 2,
      title: "Installation & Styling Day",
      tasks: [
        needsLighting
          ? "Priority: replace ALL light bulbs with warm smart LEDs — start with bedroom, then living room"
          : "Swap overhead bulbs for warm smart LEDs and set up a bedside or floor lamp",
        "Install smart door lock (20 mins, Phillips screwdriver)",
        "Make bed with hotel linen — crisp folds, layered pillows, throw at foot",
        "Style surfaces: living room tray, bedside arrangement, bathroom vanity set",
        "Place plants strategically — window sill, shelf, and one bathroom corner",
        "Set up reed diffuser at entry hallway for first-impression scent",
      ],
    },
    {
      day: 3,
      title: "Photography Day",
      tasks: [
        "Set up ring light and shoot in golden-hour natural light (7–9am or 5–7pm)",
        "Shoot from door corners at chest height — captures full room depth",
        "Hero shots: bed, bathroom, main living area, any unique feature",
        "Upload to Airbnb — update listing title to mention 'newly styled'",
        "Check first listing photo on mobile thumbnail — it must be stunning at small size",
      ],
    },
  ];
}

router.post("/yallaready/analyse", async (req, res) => {
  try {
    const {
      roomType = "living-room",
      budget = 2499,
      photoCount = 1,
      photoBase64List,
      photoMetrics,
      sessionId,
    } = req.body as {
      roomType?: string;
      budget?: number;
      photoCount?: number;
      photoBase64List?: string[];
      photoMetrics?: PhotoMetrics;
      sessionId?: string;
    };

    const numBudget = Number(budget);
    let vision: VisionAnalysis;
    let usedAI = false;

    const HARDCODED_FALLBACK: PhotoMetrics = { brightness: 50, warmth: 50, saturation: 35, complexity: 45, greenPresence: 10, neutralRatio: 40 };

    if (openai && photoBase64List && photoBase64List.length > 0) {
      try {
        vision = await analyseWithGPT4oVision(photoBase64List, roomType, numBudget);
        usedAI = true;
      } catch (aiError) {
        console.error("GPT-4o Vision failed, falling back to sharp pixel analysis:", aiError);
        try {
          const metrics = await analyseImageBase64WithSharp(photoBase64List[0]);
          console.log("[YallaReady] Sharp pixel metrics:", metrics);
          vision = heuristicAnalysis(photoCount, roomType, metrics, numBudget);
        } catch (sharpErr) {
          console.error("Sharp pixel analysis also failed:", sharpErr);
          vision = heuristicAnalysis(photoCount, roomType, photoMetrics ?? HARDCODED_FALLBACK, numBudget);
        }
      }
    } else if (photoBase64List && photoBase64List.length > 0) {
      // No OpenAI but have the photo — run real pixel analysis
      try {
        const metrics = await analyseImageBase64WithSharp(photoBase64List[0]);
        console.log("[YallaReady] Sharp pixel metrics (no OpenAI):", metrics);
        vision = heuristicAnalysis(photoCount, roomType, metrics, numBudget);
      } catch {
        vision = heuristicAnalysis(photoCount, roomType, photoMetrics ?? HARDCODED_FALLBACK, numBudget);
      }
    } else {
      vision = heuristicAnalysis(photoCount, roomType, photoMetrics ?? HARDCODED_FALLBACK, numBudget);
    }

    const scoringResult = buildScoringFromVision(vision);
    const products = suggestDubaiProducts(roomType, numBudget, vision);
    const dayByDayPlan = buildDayByDayPlan(vision);

    const budgetBreakdown = {
      products: Math.round(numBudget * 0.65),
      installation: Math.round(numBudget * 0.15),
      photography: Math.round(numBudget * 0.12),
      smartLock: Math.round(numBudget * 0.08),
      total: numBudget,
      currency: "AED",
    };

    const analysisId = `ys-${Date.now()}`;
    const responsePayload = {
      analysisId,
      roomType,
      budget: numBudget,
      photoAnalysis: {
        detected: vision.detected,
        roomCondition: vision.roomCondition,
      },
      score: scoringResult,
      issues: vision.issues,
      improvements: vision.improvements,
      products,
      budgetBreakdown,
      dayByDayPlan,
      pdfStatus: { ready: true, message: "PDF report ready for browser print — open window.print() from the results page" },
      aiConceptPlaceholder: {
        available: usedAI,
        message: usedAI
          ? "Analysis powered by GPT-4o Vision — results reflect your actual room photos"
          : "Analysis based on photo pixel data — upload photos for AI-powered results",
      },
    };

    if (sessionId) {
      try {
        await db.insert(yallareadyAnalysesTable).values({
          analysisId,
          sessionId,
          roomType,
          budget: numBudget,
          scoreBefore: scoringResult.overall.before,
          scoreAfter: scoringResult.overall.after,
          resultJson: JSON.stringify(responsePayload),
        });
      } catch (dbErr) {
        console.error("Failed to save analysis to DB:", dbErr);
      }
    }

    res.json(responsePayload);
  } catch (err) {
    console.error("YallaReady analyse error:", err);
    res.status(500).json({ error: "Analysis failed — please try again" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI CONCEPT GENERATION
// Products and DALL-E 3 prompt per budget tier
// ─────────────────────────────────────────────────────────────────────────────
const CONCEPT_PRODUCTS: Record<string, Array<{
  name: string; store: string; cost: string;
  priority: "must-have" | "nice-to-have"; category: string; note: string;
}>> = {
  "budget-refresh": [
    { name: "TRADFRI Smart LED Bulb Kit (4-pack)", store: "IKEA UAE", cost: "AED 149–199", priority: "must-have", category: "Lighting", note: "Warm 2700K — biggest single improvement for listing photos" },
    { name: "FEJKA Artificial Plant Set (3pcs)", store: "IKEA UAE", cost: "AED 59–89", priority: "must-have", category: "Greenery", note: "Highest-ROI styling addition — adds life instantly" },
    { name: "Linen Throw Blanket (130×170cm)", store: "Pottery Barn UAE", cost: "AED 249–399", priority: "must-have", category: "Textile", note: "Adds warmth and depth to sofa or bed" },
    { name: "Scented Reed Diffuser (Oud & Amber)", store: "Home Centre", cost: "AED 89–129", priority: "must-have", category: "Fragrance", note: "Signature Dubai scent — most-mentioned by 5-star guests" },
    { name: "Bamboo Floating Shelves (Set of 3)", store: "Home Centre", cost: "AED 149–199", priority: "nice-to-have", category: "Storage & Decor", note: "Vertical interest without using floor space" },
    { name: "Acacia Wood Tray Set", store: "Pottery Barn UAE", cost: "AED 199–299", priority: "nice-to-have", category: "Decor", note: "Creates photogenic styled vignettes on surfaces" },
  ],
  "standard-upgrade": [
    { name: "Premium Bedding Set — 1000TC King", store: "Home Centre", cost: "AED 299–399", priority: "must-have", category: "Linen", note: "#1 guest-mentioned upgrade in Dubai 5-star reviews" },
    { name: "Velvet Blackout Curtains (Set of 2, 2.4m)", store: "Home Centre", cost: "AED 299–449", priority: "must-have", category: "Window Treatment", note: "Critical for guest sleep quality in Dubai's sunny climate" },
    { name: "Egyptian Cotton Hotel Towel Set (6pcs)", store: "Home Centre", cost: "AED 199–279", priority: "must-have", category: "Linen", note: "Hotel-standard — directly drives bathroom reviews" },
    { name: "SYMFONISK Picture Frame Wi-Fi Speaker", store: "IKEA UAE", cost: "AED 299–349", priority: "must-have", category: "Decor & Audio", note: "Art that plays music — distinctly elevated feel" },
    { name: "Professional Ring Light with Tripod (18\")", store: "Amazon UAE", cost: "AED 149–249", priority: "must-have", category: "Photography Prep", note: "40% more bookings with properly lit listing photos" },
    { name: "Marble Effect Bath Accessory Set (5pcs)", store: "Pottery Barn UAE", cost: "AED 299–449", priority: "nice-to-have", category: "Bathroom", note: "Transforms a standard bathroom into spa-like experience" },
  ],
  "premium-look": [
    { name: "Smart Keypad Door Lock (Bluetooth + App)", store: "Amazon UAE", cost: "AED 450–650", priority: "must-have", category: "Smart Access", note: "Baseline guest expectation in Dubai Airbnb market" },
    { name: "Nespresso Vertuo Coffee Machine", store: "Amazon UAE", cost: "AED 499–799", priority: "must-have", category: "Appliance", note: "Mentioned in 60%+ of five-star Dubai holiday home reviews" },
    { name: "Premium Bedding + Full Cushion Set", store: "Pottery Barn UAE", cost: "AED 599–899", priority: "must-have", category: "Linen", note: "Complete hotel bedroom styling package" },
    { name: "Gallery Wall Art Set (3 prints + frames)", store: "Pottery Barn UAE", cost: "AED 399–699", priority: "must-have", category: "Wall Decor", note: "Blank walls are the top listing photo complaint in reviews" },
    { name: "Velvet Curtains + Sheer Lining Layer", store: "Home Centre", cost: "AED 450–700", priority: "must-have", category: "Window Treatment", note: "Layered curtains create the luxury hotel feel instantly" },
    { name: "KALLAX Shelf Unit + Styling Bundle", store: "IKEA UAE", cost: "AED 349–599", priority: "nice-to-have", category: "Storage & Decor", note: "Organised display with curated decorative items" },
    { name: "Luxury Scented Candle Collection (6pcs)", store: "Home Centre", cost: "AED 199–349", priority: "nice-to-have", category: "Fragrance", note: "Multi-room scent layering for full sensory experience" },
  ],
  "luxury": [
    { name: "Smart Lock + Ring Video Doorbell Bundle", store: "Amazon UAE", cost: "AED 799–1,200", priority: "must-have", category: "Smart Security", note: "Full smart entry — builds premium guest trust instantly" },
    { name: "Full Furniture Styling Package", store: "Pottery Barn UAE", cost: "AED 2,500–4,000", priority: "must-have", category: "Furniture", note: "Designer-curated living or bedroom set, fully installed" },
    { name: "Hotel Linen Complete Package (Bed + Bath)", store: "Home Centre", cost: "AED 899–1,400", priority: "must-have", category: "Linen", note: "Full bedroom and bathroom at five-star hotel standard" },
    { name: "Custom Framed Gallery Wall (bespoke art)", store: "Dubai Frame Art", cost: "AED 599–1,200", priority: "must-have", category: "Wall Decor", note: "Bespoke art — instantly makes the listing recognisable" },
    { name: "Professional Photography Session", store: "YallaReady Pro", cost: "AED 699–1,200", priority: "must-have", category: "Photography", note: "Professional shoot adds 40%+ more booking conversions" },
    { name: "Nespresso Vertuo + Premium Coffee Kit", store: "Amazon UAE", cost: "AED 699–1,100", priority: "must-have", category: "Appliance", note: "Full barista station — transforms kitchen experience" },
    { name: "Smart Home Hub + Scene Bulb System", store: "Amazon UAE", cost: "AED 499–899", priority: "nice-to-have", category: "Smart Home", note: "Alexa-controlled lighting scenes — wow factor for guests" },
    { name: "Luxury 5-Piece Fragrance Station", store: "Pottery Barn UAE", cost: "AED 399–699", priority: "nice-to-have", category: "Fragrance", note: "Multi-room signature scent — memorable sensory identity" },
  ],
};

// Build a detailed DALL-E 3 prompt for the selected room type and budget tier
function buildConceptPrompt(roomType: string, budgetTier: string): string {
  const room = roomType.replace(/-/g, " ");
  const styles: Record<string, string> = {
    "budget-refresh": "refreshed with warm 2700K smart LED lighting, lush potted plants, textured linen throw blanket draped on the sofa, styled floating shelves, and a reed diffuser on the coffee table",
    "standard-upgrade": "upgraded to hotel quality with crisp white hotel bedding, floor-to-ceiling velvet blackout curtains, a curated gallery wall with framed prints, Egyptian cotton towels rolled in the bathroom, and warm layered lighting",
    "premium-look": "transformed into a premium holiday rental with a smart keypad door lock, a Nespresso coffee station on the counter, designer gallery wall art, layered curtains with sheers, plush cushion-dressed sofa, and editorial-quality styling throughout",
    "luxury": "finished to ultra-luxury five-star standard with custom bespoke furniture, a complete gallery wall, full smart home lighting scenes, hotel-grade linen on every surface, a professional coffee station, and editorial-quality interior styling",
  };
  const style = styles[budgetTier] ?? styles["standard-upgrade"];
  return `Photorealistic architectural interior design photograph of a beautifully upgraded Dubai Airbnb ${room}. The space has been ${style}. Neutral warm palette, abundant natural light from windows, modern clean aesthetic. Ultra-realistic, 4K quality, wide-angle architectural lens, no people. Shot for a premium holiday home listing.`;
}

const TIER_RANGES: Record<string, string> = {
  "budget-refresh": "AED 500 – 1,500",
  "standard-upgrade": "AED 1,500 – 4,000",
  "premium-look": "AED 4,000 – 8,000",
  "luxury": "AED 8,000+",
};

router.post("/yallaready/concept", async (req, res) => {
  const startTime = Date.now();
  const { roomType = "living-room", budgetTier = "standard-upgrade", photoBase64, userName, userEmail, userPhone } = req.body as {
    roomType?: string; budgetTier?: string; photoBase64?: string;
    userName?: string; userEmail?: string; userPhone?: string;
  };

  console.log("[YallaReady Concept]", {
    roomType, budgetTier,
    photoSizeKB: photoBase64 ? Math.round(photoBase64.length * 0.75 / 1024) : 0,
    userEmail: userEmail ?? "anonymous",
  });

  // Always respond with something — never show "failed"
  const safeFallback = (extra: Record<string, any> = {}) => {
    return res.json({
      imageUrl: null,
      products: CONCEPT_PRODUCTS[budgetTier] ?? CONCEPT_PRODUCTS["standard-upgrade"],
      costBreakdown: getRoomCostBreakdown(roomType, budgetTier),
      isFromFallback: true,
      ...extra,
    });
  };

  try {
    // ── Trial user check / register ──
    let trialUser: any = null;
    if (userEmail) {
      const normalizedEmail = userEmail.toLowerCase().trim();
      const [existing] = await db.select().from(yallareadyTrialUsersTable)
        .where(eq(yallareadyTrialUsersTable.email, normalizedEmail));
      if (existing) {
        trialUser = existing;
        if (existing.imageCount >= 1) {
          return res.json({ trialExhausted: true, trialUser: existing });
        }
      } else if (userName && userPhone) {
        const [newUser] = await db.insert(yallareadyTrialUsersTable)
          .values({ name: userName, email: normalizedEmail, phone: userPhone, imageCount: 0 })
          .returning();
        trialUser = newUser;
      }
    }

    const budgetPrompt = BUDGET_PROMPTS[budgetTier] ?? BUDGET_PROMPTS["standard-upgrade"];
    const costBreakdown = getRoomCostBreakdown(roomType, budgetTier);
    const products = CONCEPT_PRODUCTS[budgetTier] ?? CONCEPT_PRODUCTS["standard-upgrade"];

    let imageUrl: string | null = null;
    let apiProvider = "none";
    let isFromFallback = false;
    let apiError: string | null = null;

    // ── Attempt 1: Replicate interior-design model (image-to-image) ──
    if (replicate && photoBase64) {
      try {
        console.log("[YallaReady] Attempting Replicate adirik/interior-design...");
        const t0 = Date.now();
        const output = await replicate.run("adirik/interior-design", {
          input: {
            image: `data:image/jpeg;base64,${photoBase64}`,
            prompt: `${budgetPrompt} Photorealistic, ultra high quality, Airbnb ready, Dubai holiday home interior.`,
            negative_prompt: "lowres, watermark, banner, logo, text, deformed, blurry, ugly, amateur",
            guidance_scale: 15,
            num_inference_steps: 50,
            strength: 0.8,
          },
        }) as any;
        const outputUrl = Array.isArray(output) ? output[0]?.toString() : output?.toString();
        console.log("[YallaReady] Replicate done in", Date.now() - t0, "ms, url:", outputUrl?.slice(0, 80));
        if (outputUrl) { imageUrl = outputUrl; apiProvider = "replicate"; }
      } catch (e: any) {
        apiError = e?.message ?? "replicate error";
        console.warn("[YallaReady] Replicate failed:", apiError);
      }
    }

    // ── Attempt 2: DALL-E 3 text-to-image ──
    if (!imageUrl && openai) {
      try {
        console.log("[YallaReady] Attempting DALL-E 3...");
        const t0 = Date.now();
        // Race against a 50-second timeout so we always respond in time
        const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
          Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`Timed out after ${ms}ms`)), ms))]);
        const genResponse = await withTimeout(
          openai.images.generate({
            model: "dall-e-3",
            prompt: buildConceptPrompt(roomType, budgetTier),
            size: "1792x1024",
            quality: "standard",
            n: 1,
          }),
          50000,
        );
        imageUrl = genResponse.data?.[0]?.url ?? null;
        apiProvider = "dall-e-3";
        console.log("[YallaReady] DALL-E 3 done in", Date.now() - t0, "ms, got url:", !!imageUrl);
      } catch (e: any) {
        apiError = (apiError ? apiError + "; " : "") + (e?.message ?? "dalle error");
        console.warn("[YallaReady] DALL-E 3 failed:", e?.message);
      }
    }

    // ── Fallback 3: return user's own photo so something is always shown ──
    if (!imageUrl) {
      if (photoBase64) {
        imageUrl = `data:image/jpeg;base64,${photoBase64}`;
        apiProvider = "fallback-original-photo";
      } else {
        apiProvider = "fallback-none";
      }
      isFromFallback = true;
    }

    // ── Increment trial user imageCount ──
    if (trialUser) {
      await db.update(yallareadyTrialUsersTable)
        .set({ imageCount: sql`${yallareadyTrialUsersTable.imageCount} + 1` })
        .where(eq(yallareadyTrialUsersTable.id, trialUser.id));
    }

    const responseTimeMs = Date.now() - startTime;
    console.log("[YallaReady] Concept done in", responseTimeMs, "ms, provider:", apiProvider);

    res.json({
      imageUrl,
      products,
      costBreakdown,
      isFromFallback,
      debugInfo: {
        apiProvider,
        responseTimeMs,
        budgetTier,
        roomType,
        userEmail: userEmail ?? null,
        imageCount: trialUser ? (trialUser.imageCount + 1) : null,
        apiError,
        replicateConfigured: !!process.env["REPLICATE_API_TOKEN"],
        openaiConfigured: !!process.env["OPENAI_API_KEY"],
      },
    });
  } catch (err: any) {
    console.error("[YallaReady] Critical concept error:", err);
    return safeFallback({ debugInfo: { apiProvider: "emergency-fallback", apiError: err?.message } });
  }
});

router.post("/yallaready/trial-user", async (req, res) => {
  try {
    const { name, email, phone } = req.body as { name?: string; email?: string; phone?: string };
    if (!email) return res.status(400).json({ error: "Email is required" });
    const normalizedEmail = email.toLowerCase().trim();
    const [existing] = await db.select().from(yallareadyTrialUsersTable)
      .where(eq(yallareadyTrialUsersTable.email, normalizedEmail));
    if (existing) {
      return res.json({ user: existing, canGenerate: existing.imageCount < 1, isNew: false });
    }
    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone required for new users" });
    }
    const [newUser] = await db.insert(yallareadyTrialUsersTable)
      .values({ name, email: normalizedEmail, phone, imageCount: 0 })
      .returning();
    res.json({ user: newUser, canGenerate: true, isNew: true });
  } catch (err: any) {
    console.error("[YallaReady] trial-user error:", err);
    res.status(500).json({ error: "Failed to process trial user" });
  }
});

router.get("/yallaready/debug", async (req, res) => {
  try {
    const users = await db.select().from(yallareadyTrialUsersTable)
      .orderBy(desc(yallareadyTrialUsersTable.createdAt)).limit(100);
    const totalGenerations = users.reduce((s, u) => s + u.imageCount, 0);
    res.json({
      users: users.map(u => ({ ...u, canGenerate: u.imageCount < 1 })),
      stats: {
        totalUsers: users.length,
        totalGenerations,
        usersWithFreeUsed: users.filter(u => u.imageCount >= 1).length,
        replicateConfigured: !!process.env["REPLICATE_API_TOKEN"],
        openaiConfigured: !!process.env["OPENAI_API_KEY"],
        apiProvider: process.env["REPLICATE_API_TOKEN"] ? "replicate" : process.env["OPENAI_API_KEY"] ? "dalle-3" : "fallback-stock",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/yallaready/analyses", async (req, res) => {
  try {
    const { sessionId } = req.query as { sessionId?: string };
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }
    const rows = await db
      .select({
        analysisId: yallareadyAnalysesTable.analysisId,
        sessionId: yallareadyAnalysesTable.sessionId,
        roomType: yallareadyAnalysesTable.roomType,
        budget: yallareadyAnalysesTable.budget,
        scoreBefore: yallareadyAnalysesTable.scoreBefore,
        scoreAfter: yallareadyAnalysesTable.scoreAfter,
        createdAt: yallareadyAnalysesTable.createdAt,
      })
      .from(yallareadyAnalysesTable)
      .where(eq(yallareadyAnalysesTable.sessionId, sessionId))
      .orderBy(desc(yallareadyAnalysesTable.createdAt));
    res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    console.error("YallaReady analyses list error:", err);
    res.status(500).json({ error: "Failed to fetch analyses" });
  }
});

router.get("/yallaready/analyses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db
      .select()
      .from(yallareadyAnalysesTable)
      .where(eq(yallareadyAnalysesTable.analysisId, id));
    if (!row) {
      return res.status(404).json({ error: "Analysis not found" });
    }
    res.json(JSON.parse(row.resultJson));
  } catch (err) {
    console.error("YallaReady analysis fetch error:", err);
    res.status(500).json({ error: "Failed to fetch analysis" });
  }
});

export default router;
