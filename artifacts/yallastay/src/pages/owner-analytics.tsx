import { apiFetch } from "@/lib/api-fetch";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Activity, LogIn, CreditCard, Clock, Shield,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
const OWNER_EMAIL = "clifford.landman@icloud.com";

function fmt(seconds: number): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `<1m`;
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  manager:     "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  cleaner:     "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  accountant:  "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

export default function OwnerAnalytics() {
  const { user, token } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["owner-analytics"],
    queryFn: async () => {
      const r = await apiFetch(`${API}/api/owner-analytics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Forbidden");
      return r.json();
    },
    enabled: !!token,
    refetchInterval: 30000,
  });

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Owner Analytics</h1>
          <p className="text-xs text-muted-foreground">Private dashboard — live data</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {isLoading ? Array(4).fill(0).map((_, i) => (
          <Card key={i}><CardContent className="pt-4"><Skeleton className="h-10 w-full" /></CardContent></Card>
        )) : [
          { icon: Users,       label: "Total Users",     val: data?.stats?.totalUsers ?? 0,         cls: "text-violet-600" },
          { icon: Activity,    label: "Active Now",       val: data?.stats?.activeNow ?? 0,          cls: "text-emerald-600" },
          { icon: LogIn,       label: "Logins Today",    val: data?.stats?.loginsToday ?? 0,        cls: "text-blue-600" },
          { icon: CreditCard,  label: "Subscribers",     val: data?.stats?.totalSubscriptions ?? 0, cls: "text-amber-600" },
        ].map(({ icon: Icon, label, val, cls }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <div className={`text-2xl font-bold ${cls}`}>{val}</div>
              <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <Icon className="h-3 w-3" />{label}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Users table */}
        <div className="lg:col-span-3">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />Users
          </h2>
          <div className="bg-card border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Name / Email</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground hidden sm:table-cell">Role</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground hidden md:table-cell">Last Login</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground text-right">Sessions</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">Time on Site</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? Array(3).fill(0).map((_, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-4 py-3" colSpan={5}><Skeleton className="h-5 w-full" /></td>
                  </tr>
                )) : (data?.users ?? []).map((u: any) => (
                  <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                          {u.name?.[0]?.toUpperCase() ?? "?"}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-xs truncate">{u.name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <Badge className={`text-[10px] px-2 py-0.5 ${ROLE_COLORS[u.role] ?? "bg-muted text-muted-foreground"}`}>
                        {u.role}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <span className="text-[11px] text-muted-foreground">
                        {u.lastLogin ? formatDistanceToNow(new Date(u.lastLogin), { addSuffix: true }) : "Never"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="text-xs font-medium">{u.sessions}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{fmt(u.totalTimeSeconds)}</span>
                    </td>
                  </tr>
                ))}
                {!isLoading && (data?.users ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No users yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent sessions */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />Recent Logins
          </h2>
          <div className="bg-card border rounded-xl divide-y max-h-[420px] overflow-y-auto">
            {isLoading ? Array(5).fill(0).map((_, i) => (
              <div key={i} className="p-3"><Skeleton className="h-8 w-full" /></div>
            )) : (data?.recentSessions ?? []).length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No sessions yet</div>
            ) : (data?.recentSessions ?? []).map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold shrink-0">
                  {s.userName?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{s.userName ?? s.userEmail}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {s.startedAt ? format(new Date(s.startedAt), "MMM d, HH:mm") : "—"}
                    {s.durationSeconds ? ` · ${fmt(s.durationSeconds)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!s.endedAt ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Active
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Done</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Subscriptions */}
      <div>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />Subscriptions
        </h2>
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : (data?.subscriptions ?? []).length === 0 ? (
          <div className="bg-card border rounded-xl p-6 text-center text-sm text-muted-foreground">
            No subscriptions yet — they will appear here when clients sign up.
          </div>
        ) : (
          <div className="bg-card border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Client</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground">Plan</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground text-right">Monthly</th>
                  <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground hidden sm:table-cell">Since</th>
                </tr>
              </thead>
              <tbody>
                {(data?.subscriptions ?? []).map((s: any) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-xs">{s.clientName}</div>
                      {s.contactEmail && <div className="text-[11px] text-muted-foreground">{s.contactEmail}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs font-medium capitalize">{s.plan}</span>
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={`text-[10px] px-2 py-0.5 ${
                        s.status === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" :
                        s.status === "trial" ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {s.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right text-xs font-medium">AED {s.monthlyAmount}</td>
                    <td className="px-4 py-3 text-[11px] text-muted-foreground hidden sm:table-cell">
                      {s.createdAt ? format(new Date(s.createdAt), "MMM d, yyyy") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
