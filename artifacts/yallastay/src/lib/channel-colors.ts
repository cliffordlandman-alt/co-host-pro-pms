/**
 * One colour per channel, used everywhere a channel colour is shown: month calendar, Multi-Calendar, owner portal
 * calendar, legends, badges, dots and the channel chart. Change a colour here and it changes everywhere.
 *
 * - bg / text:          solid bars, dots and legend swatches (text drawn on top of bg).
 * - softBg / softText:  tinted badges (reservation list, booking page, inbox, reviews).
 * Every text/background pair is at least 4.5:1 (WCAG AA for small text); scripts/test-channel-colors.mjs checks it.
 * Airbnb's coral and Vrbo's teal are light, so their bars use dark text; white text on #FF5A5F is only 3.0:1.
 */
export type ChannelKey = "airbnb" | "booking_com" | "vrbo" | "direct" | "owner" | "blocked" | "other";
export type ChannelColor = { key: ChannelKey; label: string; bg: string; text: string; softBg: string; softText: string; border: string };

const DARK = "#111827";
const WHITE = "#FFFFFF";

export const CHANNEL_COLORS: Record<ChannelKey, ChannelColor> = {
  airbnb:      { key: "airbnb",      label: "Airbnb",      bg: "#FF5A5F", text: DARK,  softBg: "#FFE8E9", softText: "#B4232A", border: "#FFC2C4" },
  booking_com: { key: "booking_com", label: "Booking.com", bg: "#003580", text: WHITE, softBg: "#E6EEF8", softText: "#003580", border: "#B3C7E3" },
  vrbo:        { key: "vrbo",        label: "Vrbo",        bg: "#14B8A6", text: DARK,  softBg: "#DDF6F2", softText: "#0F5F58", border: "#A3E4DB" },
  direct:      { key: "direct",      label: "Direct",      bg: "#15803D", text: WHITE, softBg: "#E7F6EC", softText: "#166534", border: "#B7E2C4" },
  owner:       { key: "owner",       label: "Owner stay",  bg: "#6D28D9", text: WHITE, softBg: "#EFE7FD", softText: "#5B21B6", border: "#D5C3F7" },
  blocked:     { key: "blocked",     label: "Blocked",     bg: "#6B7280", text: WHITE, softBg: "#F1F2F4", softText: "#374151", border: "#D1D5DB" },
  other:       { key: "other",       label: "Other",       bg: "#1E293B", text: WHITE, softBg: "#E2E8F0", softText: "#1E293B", border: "#CBD5E1" },
};

/** Legend order on every calendar. */
export const LEGEND: ChannelKey[] = ["airbnb", "booking_com", "vrbo", "direct", "owner", "blocked"];

type Booking = { platform?: string | null; status?: string | null; guestName?: string | null };

/** Owner stays are manual blocks (Block dates → "Owner stay"), saved as "Blocked: Owner stay…". */
export const isOwnerStay = (b: Booking) => b.status === "blocked" && (!b.platform || b.platform === "direct") && /owner\s*stay/i.test(b.guestName ?? "");

/** Colour key for a channel name alone (badges, chart slices). Manual/unknown-source bookings are direct. */
export function platformKey(platform?: string | null): ChannelKey {
  if (!platform || platform === "direct" || platform === "manual") return "direct";
  if (platform === "airbnb" || platform === "booking_com" || platform === "vrbo") return platform;
  return "other";
}

/** Colour key for a calendar entry: owner stays and blocks first, then the booking's channel. */
export function channelKey(b: Booking): ChannelKey {
  if (isOwnerStay(b)) return "owner";
  if (b.status === "blocked") return "blocked";
  return platformKey(b.platform);
}

export const channelColor = (b: Booking) => CHANNEL_COLORS[channelKey(b)];
export const platformColor = (platform?: string | null) => CHANNEL_COLORS[platformKey(platform)];
export const platformLabel = (platform?: string | null) => (platformKey(platform) === "other" && platform ? platform.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()) : platformColor(platform).label);
/** Solid bar / swatch style for a calendar entry. */
export const barStyle = (b: Booking) => { const c = channelColor(b); return { background: c.bg, color: c.text }; };
/** Tinted badge style for a channel. */
export const badgeStyle = (platform?: string | null) => { const c = platformColor(platform); return { background: c.softBg, color: c.softText, borderColor: c.border }; };

/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Legend/badge label for a calendar entry ("Owner stay", "Blocked", or the channel name). */
export const entryLabel = (b: Booking) => { const k = channelKey(b); return k === "owner" || k === "blocked" ? CHANNEL_COLORS[k].label : platformLabel(b.platform); };
/** Tinted badge for a booking row: same colour family as its calendar bar (owner stay purple, blocks grey). */
export const entryBadgeStyle = (b: Booking) => { const c = channelColor(b); return { background: c.softBg, color: c.softText, borderColor: c.border }; };
/** Badge text for a booking row: "Owner stay", "Blocked · Airbnb" for a channel block, "Blocked", or the channel. */
export const entryBadgeLabel = (b: Booking) => { const k = channelKey(b); return k === "owner" ? CHANNEL_COLORS.owner.label : k === "blocked" ? (b.platform && b.platform !== "direct" ? `Blocked · ${platformLabel(b.platform)}` : "Blocked") : platformLabel(b.platform); };
