import { calendarBookingName } from "@/lib/calendar-labels";
export { calendarBookingName, isBlock, isChannelBlock } from "@/lib/calendar-labels";
type Booking = { platform?: string; guestName?: string | null; status?: string };

export function AirbnbLogo() {
  return <svg viewBox="0 0 32 32" role="img" aria-label="Airbnb" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21c-3-3-5-6-5-8a5 5 0 0 1 10 0c0 2-2 5-5 8Zm0 0c-4 5-7 8-10 6-4-2-2-6-1-9L12 4c2-4 6-4 8 0l7 14c1 3 3 7-1 9-3 2-6-1-10-6Z"/></svg>;
}

export function CalendarBookingLabel({ booking, label }: { booking: Booking; label?: string }) {
  return <span className="flex items-center gap-1 min-w-0">{booking.platform === "airbnb" && <AirbnbLogo />}<span className="truncate">{label ?? calendarBookingName(booking)}</span></span>;
}
