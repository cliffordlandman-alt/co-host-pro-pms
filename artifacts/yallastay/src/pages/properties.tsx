import { AddPropertyDialog } from "@/components/properties/AddPropertyDialog";
import { useState } from "react";
import { useGetProperties, getGetPropertiesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Building2, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { DirectBookingDialog } from "@/components/DirectBookingDialog";
import { PropertyEditDrawer } from "@/components/properties/PropertyEditDrawer";
import { PropertyCard, type PropertyItem } from "@/components/properties/PropertyCard";

export default function Properties() {
  const { data: propertyResponse, isLoading } = useGetProperties();
  const apiProperties = propertyResponse as PropertyItem[] | undefined;
  const queryClient = useQueryClient();
  const [showAdd,setShowAdd]=useState(false);
  const [filterArea, setFilterArea] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"active" | "archived" | "all">("active");
  const [editPropertyId, setEditPropertyId] = useState<number | null>(()=>Number(new URLSearchParams(window.location.search).get("property")) || null);
  const [bookingPropertyId, setBookingPropertyId] = useState<string | null>(null);

  function invalidateProperties() {
    queryClient.invalidateQueries({ queryKey: getGetPropertiesQueryKey() });
  }

  const areas = Array.from(new Set((apiProperties ?? []).map((p: PropertyItem) => p.area).filter((area): area is string => !!area)));

  const statusFiltered = filterStatus === "all"
    ? (apiProperties ?? [])
    : (apiProperties ?? []).filter((p: PropertyItem) => p.status === filterStatus);

  const filtered = filterArea === "all"
    ? statusFiltered
    : statusFiltered.filter((p: PropertyItem) => p.area === filterArea);

  const activeCount = (apiProperties ?? []).filter((p: PropertyItem) => p.status === "active").length;
  const archivedCount = (apiProperties ?? []).filter((p: PropertyItem) => p.status === "archived").length;

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Properties</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeCount} active{archivedCount > 0 ? ` · ${archivedCount} archived` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowAdd(true)} className="font-semibold gap-2" style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)", border: "none", boxShadow: "0 2px 12px rgba(13,148,136,0.3)" }}>
            <Plus className="h-4 w-4" />
            Add property
          </Button>
        </div>
      </div>

      <AddPropertyDialog open={showAdd} onOpenChange={setShowAdd}/>
      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {(["active", "archived", "all"] as const).map(s => {
          const count = s === "all" ? (apiProperties?.length ?? 0) : s === "active" ? activeCount : archivedCount;
          return (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterStatus === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {s === "active" ? "Active" : s === "archived" ? "Archived" : "All"} ({count})
            </button>
          );
        })}
      </div>

      {/* Area filter */}
      {areas.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilterArea("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterArea === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
            All Areas ({statusFiltered.length})
          </button>
          {areas.map(area => (
            <button key={area} onClick={() => setFilterArea(area)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterArea === area ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {area} ({statusFiltered.filter((p: PropertyItem) => p.area === area).length})
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array(6).fill(0).map((_, i) => (
            <div key={i} className="rounded-2xl overflow-hidden border bg-card">
              <Skeleton className="h-52 w-full rounded-none" />
              <div className="p-4 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3.5 w-1/2" />
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-3.5 w-16" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : apiProperties?.length === 0 ? (
        <div className="rounded-2xl border bg-card py-20 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-muted-foreground/30" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
            </svg>
          </div>
          <div className="font-semibold text-muted-foreground text-lg">No properties yet</div>
          <div className="text-sm text-muted-foreground/60">Add your first property, then connect its Airbnb calendar on Platforms</div>
          <Button onClick={() => setShowAdd(true)} size="sm" className="mt-1"
            style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)", border: "none" }}>
            Add property
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border bg-card py-16 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto">
            <Building2 className="w-6 h-6 text-muted-foreground/40" />
          </div>
          <div className="font-semibold text-muted-foreground">
            {filterStatus === "archived" ? "No archived properties" : "No properties match this filter"}
          </div>
          {filterStatus === "archived" && (
            <div className="text-sm text-muted-foreground/60 max-w-xs">
              Archive properties you no longer manage by opening the edit drawer and clicking "Archive Property".
            </div>
          )}
          <button onClick={() => { setFilterStatus("active"); setFilterArea("all"); }}
            className="text-xs text-teal-400 hover:text-teal-300 transition-colors mt-1">
            View active properties
          </button>
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: "860px" }}>
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs w-[300px]">Listing</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Unit type</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Listing ID</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Location</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Tags</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Channels</th>
                  <th className="px-4 py-3 w-28 text-right">
                    <button className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((property: PropertyItem) => (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    onEdit={id => setEditPropertyId(id)}
                    onAddBooking={id => setBookingPropertyId(id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination bar */}
          <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground bg-muted/10">
            <span>Page 1 of 1</span>
            <div className="flex items-center gap-1">
              <button disabled className="flex items-center gap-1 px-3 py-1.5 rounded-md border bg-card hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft className="w-3.5 h-3.5" /> Previous
              </button>
              <button className="w-8 h-7 rounded-md bg-primary text-primary-foreground text-xs font-semibold">1</button>
              <button disabled className="flex items-center gap-1 px-3 py-1.5 rounded-md border bg-card hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              Items per page:
              <select className="border rounded px-2 py-1 bg-card text-xs cursor-pointer">
                <option>20</option>
                <option>50</option>
                <option>100</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Import Wizard */}
      <AnimatePresence>
      </AnimatePresence>

      {/* Edit Drawer */}
      <AnimatePresence>
        {editPropertyId != null && (
          <PropertyEditDrawer
            propertyId={editPropertyId}
            onClose={() => setEditPropertyId(null)}
            onSaved={() => invalidateProperties()}
            onDeleted={() => { invalidateProperties(); setEditPropertyId(null); }}
          />
        )}
      </AnimatePresence>

      {/* Quick Add Booking */}
      <DirectBookingDialog
        open={bookingPropertyId != null}
        onOpenChange={(open) => { if (!open) setBookingPropertyId(null); }}
        defaultPropertyId={bookingPropertyId ?? undefined}
      />
    </div>
  );
}
