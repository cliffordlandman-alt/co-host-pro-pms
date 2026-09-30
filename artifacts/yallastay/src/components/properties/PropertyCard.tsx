import { Pencil, CalendarDays, MoreHorizontal } from "lucide-react";

export interface PropertyItem {
  city?: string | null; country?: string | null; bedrooms?: number | null;
  id: number;
  name: string;
  unitNumber: string | null;
  building: string | null;
  area: string | null;
  bedroomType: string | null;
  status: string;
  description: string | null;
  photos: string | null;
  airbnbListingId: string | null;
  bookingComIcalUrl: string | null;
}

interface PropertyCardProps {
  property: PropertyItem;
  onEdit: (id: number) => void;
  onAddBooking: (id: string) => void;
}

export function PropertyCard({ property, onEdit, onAddBooking }: PropertyCardProps) {
  let firstPhoto: string | null = null;
  try {
    const parsed = JSON.parse(property.photos || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) firstPhoto = parsed[0];
  } catch {}

  const isLive = property.status === "active";
  const location = [property.area, property.city, property.country].filter(Boolean).join(", ");
  const unitType = property.bedroomType || (property.bedrooms == null ? "Not recorded" : property.bedrooms === 0 ? "Studio" : `${property.bedrooms} bedroom`);
  const desc = [property.building, property.unitNumber, property.description?.slice(0, 40)].filter(Boolean).join(" | ");

  return (
    <tr
      className="border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors group"
      onClick={() => onEdit(property.id)}
    >
      {/* Listing: photo + name + desc */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-[60px] h-[42px] rounded-md overflow-hidden bg-muted flex-shrink-0 border">
            {firstPhoto ? (
              <img
                src={firstPhoto}
                alt=""
                className="w-full h-full object-cover"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-teal-500/10 to-sky-500/10">
                <svg className="w-5 h-5 opacity-25" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#0d9488" }}>
                  <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                </svg>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate max-w-[200px]">{property.name}</div>
            {desc && <div className="text-xs text-muted-foreground truncate max-w-[200px] mt-0.5">{desc}</div>}
          </div>
        </div>
      </td>
      {/* Unit type */}
      <td className="px-4 py-3 text-sm text-muted-foreground">{unitType}</td>
      {/* Listing ID */}
      <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">{property.id}</td>
      {/* Location */}
      <td className="px-4 py-3 text-sm text-muted-foreground max-w-[160px]">
        <span className="block truncate" title={location}>{location}</span>
      </td>
      {/* Status */}
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${isLive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
          {isLive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
          {isLive ? "Active" : property.status}
        </span>
      </td>
      {/* Tags */}
      <td className="px-4 py-3">
        <button onClick={e => {e.stopPropagation();onEdit(property.id);}} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </td>
      {/* Channels */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          {property.airbnbListingId && (
            <div className="w-6 h-6 rounded-full bg-[#FF385C] flex items-center justify-center flex-shrink-0" title="Airbnb">
              <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 2.4c5.302 0 9.6 4.298 9.6 9.6s-4.298 9.6-9.6 9.6S2.4 17.302 2.4 12 6.698 2.4 12 2.4zm0 3.6c-1.325 0-2.4 1.075-2.4 2.4S10.675 10.8 12 10.8s2.4-1.075 2.4-2.4S13.325 6 12 6zm-4.2 6.6c-.497 0-.9.403-.9.9v.3c0 2.487 2.238 4.5 4.8 4.5s4.8-2.013 4.8-4.5v-.3c0-.497-.403-.9-.9-.9H7.8z" />
              </svg>
            </div>
          )}
          {property.bookingComIcalUrl && (
            <div className="w-6 h-6 rounded-full bg-[#003580] flex items-center justify-center flex-shrink-0" title="Booking.com">
              <span className="text-white text-[9px] font-bold leading-none">B</span>
            </div>
          )}
          {!property.airbnbListingId && !property.bookingComIcalUrl && (
            <span className="text-xs text-muted-foreground/40">—</span>
          )}
        </div>
      </td>
      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1 opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onEdit(property.id); }}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onAddBooking(String(property.id)); }}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            title="Add booking"
          >
            <CalendarDays className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => {e.stopPropagation();onEdit(property.id);}}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            title="More"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
