import { useState } from "react";
import { CompanyFinance } from "@/components/CompanyFinance";
import { apiFetch } from "@/lib/api-fetch";
import { AirbnbIncome } from "@/components/AirbnbIncome";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, DollarSign, Home, Percent } from "lucide-react";
import { platformColor, platformLabel } from "@/lib/channel-colors";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchJson(path: string) {
  const res = await apiFetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error("API error");
  return res.json();
}

// Channel slices use the shared channel colours (lib/channel-colors.ts), so Airbnb is coral here too.

function formatMoney(n: number, currency="AED") {
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function Reports() {
  const [currency,setCurrency]=useState("AED");
  const formatAED=(n:number)=>formatMoney(n,currency);
  const { data: revenue, isLoading: loadingRev } = useQuery({ queryKey: ["reports-revenue",currency], queryFn: () => fetchJson(`/api/reports/revenue?currency=${currency}`) });
  const { data: occupancy, isLoading: loadingOcc } = useQuery({ queryKey: ["reports-occupancy"], queryFn: () => fetchJson("/api/reports/occupancy") });
  const { data: platforms, isLoading: loadingPlatforms } = useQuery({ queryKey: ["reports-platforms"], queryFn: () => fetchJson("/api/reports/platforms") });

  const totalRevenue = revenue?.reduce((s: number, m: any) => s + m.revenue, 0) ?? 0;
  const totalBookings = revenue?.reduce((s: number, m: any) => s + m.bookings, 0) ?? 0;
  const avgOccupancy = occupancy?.length ? Math.round(occupancy.reduce((s: number, p: any) => s + p.occupancyRate, 0) / occupancy.length) : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Financial Reports</h1>

      <CompanyFinance/>
      <AirbnbIncome/>
      <label className="block text-sm">Chart currency <select aria-label="Chart currency" className="border rounded p-2 bg-background" value={currency} onChange={e=>setCurrency(e.target.value)}>{['AED','ZAR','USD'].map(c=><option key={c}>{c}</option>)}</select></label><p className="text-sm text-muted-foreground">Airbnb paid earnings now appear in the monthly chart. They may be co-host shares, so they are shown separately from verified accommodation revenue and must not be added together. Booking counts include all currencies.</p>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Verified accommodation (12mo)", value: formatAED(totalRevenue), icon: DollarSign, color: "text-emerald-500" },
          { label: "Total Bookings", value: totalBookings, icon: Home, color: "text-blue-500" },
          { label: "Avg Occupancy (30d)", value: `${avgOccupancy}%`, icon: Percent, color: "text-amber-500" },
          { label: "Airbnb paid earnings (12mo)", value: formatAED(revenue?.reduce((n:number,r:any)=>n+r.airbnbIncome,0) || 0), icon: TrendingUp, color: "text-emerald-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              {loadingRev || loadingOcc ? (
                <Skeleton className="h-7 w-24 mt-1" />
              ) : (
                <div className="text-xl font-bold">{value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Accommodation & Airbnb Earnings — Last 12 Months</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRev ? <Skeleton className="h-56 w-full" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={revenue} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => formatAED(Number(v))} labelFormatter={l => `Month: ${l}`} />
                <Bar dataKey="revenue" fill="#14b8a6" radius={[4, 4, 0, 0]} name="Verified accommodation" />
                <Bar dataKey="airbnbIncome" fill="#059669" radius={[4,4,0,0]} name="Airbnb paid earnings" /><Legend />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Occupancy */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Occupancy Rate — Last 30 Days</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingOcc ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={occupancy} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="propertyName" tick={{ fontSize: 10 }} width={100} />
                  <Tooltip formatter={(v: any) => `${v}%`} />
                  <Bar dataKey="occupancyRate" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Occupancy %" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Platform Split */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Bookings by Platform</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingPlatforms ? <Skeleton className="h-48 w-full" /> : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="55%" height={180}>
                  <PieChart>
                    <Pie data={platforms} dataKey="count" nameKey="platform" cx="50%" cy="50%" outerRadius={70} label={false}>
                      {platforms?.map((p: any) => <Cell key={p.platform} fill={platformColor(p.platform).bg} />)}
                    </Pie>
                    <Tooltip formatter={(v: any, name: any) => [v, platformLabel(name)]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2">
                  {platforms?.map((p: any) => (
                    <div key={p.platform} className="flex items-center gap-2 text-sm">
                      <span className="w-3 h-3 rounded-sm inline-block flex-shrink-0" style={{ background: platformColor(p.platform).bg }} />
                      <span className="text-muted-foreground">{platformLabel(p.platform)}</span>
                      <Badge variant="secondary" className="ml-auto">{p.count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>


    </div>
  );
}
