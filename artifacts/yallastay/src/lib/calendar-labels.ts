/**
 * Calendar labels. Dates a channel's calendar marks as unavailable (iCal "Not available" / "closed" blocks) are
 * stored as `status: "blocked"` rows on that channel's platform; they are shown as "Blocked on <channel>".
 * Manual blocks (Block dates, platform "direct") keep their own label ("Blocked: <reason>").
 * Blocks are never stays: occupancy, arrivals and statements already exclude status "blocked".
 */
type Booking = { platform?: string | null; guestName?: string | null; status?: string | null };

const CHANNELS: Record<string, string> = { airbnb: "Airbnb", booking_com: "Booking.com", vrbo: "Vrbo", expedia: "Expedia" };

export function channelName(platform?: string | null) {
  if (!platform) return "channel";
  return CHANNELS[platform] ?? platform.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
}

export const isBlock = (b: Booking) => b.status === "blocked";
export const isChannelBlock = (b: Booking) => isBlock(b) && !!b.platform && b.platform !== "direct";

export function calendarBookingName(booking: Booking) {
  if (isChannelBlock(booking)) return `Blocked on ${channelName(booking.platform)}`;
  const name = booking.guestName || (isBlock(booking) ? "Blocked" : "Guest");
  return booking.platform === "direct" && name.trim().toLowerCase() === "kariem" ? "Clifford - Kariem" : name;
}
