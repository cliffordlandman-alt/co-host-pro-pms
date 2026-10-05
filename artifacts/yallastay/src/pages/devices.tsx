import { useState } from "react";
import { Tv2, MapPin, Smartphone, ChevronRight, Wifi, Lock, Thermometer, Camera, Lightbulb, Speaker } from "lucide-react";

type DeviceTab = "devices" | "mapping" | "supported";

const SUPPORTED_DEVICES = [
  { icon: Lock, name: "Smart Locks", desc: "August, Schlage, Yale, Nuki", status: "available" },
  { icon: Thermometer, name: "Smart Thermostats", desc: "Nest, Ecobee, Honeywell", status: "available" },
  { icon: Camera, name: "Security Cameras", desc: "Ring, Arlo, Nest Cam", status: "available" },
  { icon: Wifi, name: "WiFi Routers", desc: "TP-Link, Eero, Google Nest WiFi", status: "available" },
  { icon: Lightbulb, name: "Smart Lighting", desc: "Philips Hue, LIFX, Govee", status: "coming_soon" },
  { icon: Speaker, name: "Smart Speakers", desc: "Amazon Echo, Google Home", status: "coming_soon" },
  { icon: Tv2, name: "Smart TVs", desc: "Samsung, LG, Sony", status: "coming_soon" },
];

export default function Devices() {
  const [tab, setTab] = useState<DeviceTab>("devices");

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Devices</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage smart devices across your properties</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-xl p-1 w-fit">
        {([
          { id: "devices", label: "Devices", icon: Tv2 },
          { id: "mapping", label: "Listing mapping", icon: MapPin },
          { id: "supported", label: "Supported devices", icon: Smartphone },
        ] as { id: DeviceTab; label: string; icon: any }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="h-3.5 w-3.5" />{t.label}
          </button>
        ))}
      </div>

      {tab === "devices" && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center bg-card border rounded-xl">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <Tv2 className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <div>
            <div className="text-base font-semibold">No devices connected</div>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              Connect smart locks, thermostats, and other devices to automate your property management.
            </p>
          </div>
          <button className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)" }}>
            Add Device
          </button>
        </div>
      )}

      {tab === "mapping" && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center bg-card border rounded-xl">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <MapPin className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <div>
            <div className="text-base font-semibold">No device mappings</div>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              Map your devices to listings to control them automatically based on reservations.
            </p>
          </div>
          <button className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ background: "linear-gradient(135deg, #0d9488, #0891b2)" }}>
            Create Mapping
          </button>
        </div>
      )}

      {tab === "supported" && (
        <div className="space-y-3">
          {SUPPORTED_DEVICES.map(device => (
            <div key={device.name} className="flex items-center gap-4 p-4 rounded-xl border bg-card hover:bg-muted/20 transition-colors cursor-pointer">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                <device.icon className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{device.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{device.desc}</div>
              </div>
              {device.status === "coming_soon" ? (
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  Coming soon
                </span>
              ) : (
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  Available
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
