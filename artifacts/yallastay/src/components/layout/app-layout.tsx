import { CommandSearch } from "@/components/today/CommandSearch";
import { CheckCircle2, RefreshCw, ShieldCheck, History } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { Link, useLocation, useSearch } from "wouter";
import logoPath from "../../assets/yallastay-logo.png";
import {
  LayoutDashboard, Building, CalendarDays, CalendarRange, BedDouble,
  Sparkles, Wrench, Users, UserCircle, CreditCard, BarChart2, Star,
  MessageCircle, BookOpen, KeyRound, Layers, Menu, X, Zap, FileText,
  Settings2, Bot, Crown, MessageSquare, ChevronDown, LogOut, Shield,
  PieChart, Receipt, FileBarChart, Link2, Tv2, MapPin, Smartphone, DollarSign, ListChecks, Scale,
} from "lucide-react";
import { useState, useEffect } from "react";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { Button } from "@/components/ui/button";
import { NotificationsBell } from "@/components/notifications-bell";
import { useAuth, ROLE_LABELS, ROLE_COLORS } from "@/contexts/auth-context";

// Menu: the main jobs first, grouped; rarely used pages live under "More" (collapsed). Nothing is removed:
// every page keeps a menu entry. (The old "Listing mapping" and "Supported devices" entries opened the Devices
// page on its first tab; those tabs are on the Devices page.)
type NavItem = { href: string; icon: any; label: string; role?: string[]; ownerOnly?: boolean };
const navGroups: { label: string; collapsible?: boolean; items: NavItem[] }[] = [
  {
    label: "Daily",
    items: [
      { href: "/dashboard",       icon: LayoutDashboard, label: "Today" },
      { href: "/multi-calendar",  icon: CalendarRange,   label: "Calendar" },
      { href: "/reservations",    icon: BedDouble,       label: "Bookings" },
      { href: "/verify-bookings", icon: CheckCircle2,    label: "Verify bookings" },
      { href: "/cleaning",        icon: Sparkles,        label: "Cleaning" },
      { href: "/maintenance",     icon: Wrench,          label: "Maintenance" },
      { href: "/task-centre",     icon: ListChecks,      label: "Task Centre" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/income",                    icon: PieChart,     label: "Income per property" },
      { href: "/accounting",                icon: FileBarChart, label: "Owner statements" },
      { href: "/owner-history",             icon: History,      label: "Statement history" },
      { href: "/accounting?tab=transactions", icon: Receipt,    label: "Income & expenses" },
      { href: "/payments",                  icon: DollarSign,   label: "Payments" },
      { href: "/payout-check",              icon: Scale,          label: "Airbnb payout check", role: ["admin", "super_admin", "manager", "accountant"] },
      { href: "/reports",                   icon: BarChart2,    label: "Reports" },
    ],
  },
  {
    label: "Properties & people",
    items: [
      { href: "/properties", icon: Building,   label: "Properties" },
      { href: "/owners",     icon: Users,      label: "Owners" },
      { href: "/guests",     icon: UserCircle, label: "Guests" },
      { href: "/staff",      icon: UserCircle, label: "Staff" },
      { href: "/platforms",  icon: Layers,     label: "Platforms" },
      { href: "/calendar-sync", icon: RefreshCw, label: "Calendar sync", role: ["admin", "super_admin", "manager"] },
      { href: "/compliance",    icon: ShieldCheck, label: "Dubai compliance", role: ["admin", "super_admin", "manager", "accountant", "reservations", "operations"] },
    ],
  },
  {
    label: "More",
    collapsible: true,
    items: [
      { href: "/calendar",                 icon: CalendarDays,  label: "Property calendar" },
      { href: "/inbox",                    icon: MessageCircle, label: "Inbox" },
      { href: "/reviews",                  icon: Star,          label: "Reviews" },
      { href: "/accounting?tab=settings",  icon: Settings2,     label: "Fee settings" },
      { href: "/accounting?tab=company",   icon: FileText,      label: "Company statement" },
      { href: "/airbnb-import",            icon: Link2,         label: "Import Airbnb data" },
      { href: "/documents",                icon: FileText,      label: "Documents" },
      { href: "/devices",                  icon: Tv2,           label: "Devices" },
      { href: "/automations",              icon: Zap,           label: "Automations" },
      { href: "/templates",                icon: MessageSquare, label: "Templates" },
      { href: "/ai-assistant",             icon: Bot,           label: "AI Assistant" },
      { href: "/cleaner-app",              icon: Smartphone,    label: "Cleaner App", role: ["cleaner", "admin", "manager"] },
      // Dynamic Pricing (/pricing) stays hidden: its property list is hard-coded empty and its rules are not
      // applied to any rate, so it does nothing yet. The page, route and API are kept.
      { href: "/subscriptions",            icon: Crown,         label: "Subscriptions", ownerOnly: true },
      { href: "/audit-log",                icon: Shield,        label: "Activity Log",  ownerOnly: true },
      { href: "/system-health",            icon: Zap,           label: "System Health", ownerOnly: true },
    ],
  },
];

const OWNER_EMAIL_NAV = "clifford.landman@icloud.com";
/** Bottom navigation on phones: the four main places, plus the full menu (Income for roles that see finances, else Jobs). */
const BOTTOM_NAV: NavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Today" },
  { href: "/multi-calendar", icon: CalendarRange, label: "Calendar" },
  { href: "/reservations", icon: BedDouble, label: "Bookings" },
  { href: "/income", icon: PieChart, label: "Income" },
];

function useVisibleItems(items: NavItem[]) {
  const { user } = useAuth();
  return items.filter(item => {
    if (item.ownerOnly && user?.email !== OWNER_EMAIL_NAV) return false;
    return !item.role || item.role.includes(user?.role ?? "");
  });
}
/** Active when the path matches and, for /accounting?tab=…, the tab matches too. */
function useIsActive() {
  const [location] = useLocation();
  const search = useSearch();
  const tab = new URLSearchParams(search).get("tab");
  return (href: string) => {
    const [path, query] = href.split("?");
    if (path === "/income") return location === "/income" || location.startsWith("/income/");
    if (path !== location) return false;
    return (new URLSearchParams(query ?? "").get("tab") ?? null) === (path === "/accounting" ? (tab && tab !== "statements" ? tab : null) : null);
  };
}

function NavGroup({ group }: { group: typeof navGroups[0] }) {
  const items = useVisibleItems(group.items);
  const isActive = useIsActive();
  const hasActiveItem = items.some(i => isActive(i.href));
  const [expanded, setExpanded] = useState(!group.collapsible || hasActiveItem);
  if (items.length === 0) return null;
  const open = expanded || hasActiveItem;
  return (
    <div>
      <button
        onClick={() => group.collapsible && setExpanded(e => !e)}
        aria-expanded={group.collapsible ? open : undefined}
        className={`w-full flex items-center justify-between px-3 mb-1 group ${group.collapsible ? "cursor-pointer" : "cursor-default"}`}
      >
        <p className="text-[10px] uppercase tracking-widest text-sidebar-foreground/50 font-semibold">{group.label}{group.collapsible && !open ? ` (${items.length})` : ""}</p>
        {group.collapsible && <ChevronDown className={`h-3 w-3 text-sidebar-foreground/40 group-hover:text-sidebar-foreground/70 transition-all duration-200 ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && <div className="space-y-0.5">
        {items.map(item => {
          const active = isActive(item.href);
          return (
            <Link key={item.label} href={item.href}>
              <div className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm ${active ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm" : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}>
                <item.icon className="h-4 w-4 flex-shrink-0" />
                <span>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </div>}
    </div>
  );
}

function MobileNavGroup({ group, onClose }: { group: typeof navGroups[0]; onClose: () => void }) {
  const items = useVisibleItems(group.items);
  const isActive = useIsActive();
  if (!items.length) return null;
  return (
    <div className="mb-3">
      <p className="text-xs uppercase tracking-widest text-muted-foreground px-2 mb-2 font-semibold">{group.label}</p>
      <div className="grid grid-cols-2 gap-1">
        {items.map(item => (
          <Link key={item.label} href={item.href}>
            <div onClick={onClose} className={`flex items-center gap-2.5 p-3 rounded-lg transition-colors min-h-12 ${isActive(item.href) ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
              <item.icon className="h-5 w-5 flex-shrink-0" />
              <span className="font-medium text-sm leading-tight">{item.label}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  if (!user) return null;

  const initials = user.name.split(" ").map(n => n[0]).slice(0, 2).join("");
  const roleColor = ROLE_COLORS[user.role] ?? "bg-gray-100 text-gray-700";
  const roleLabel = ROLE_LABELS[user.role] ?? user.role;

  return (
    <div className="space-y-1">
      {/* User identity row */}
      <div className="flex items-center gap-2.5 px-2 py-2 rounded-md">
        <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold flex-shrink-0 text-sidebar-foreground">
          {initials}
        </div>
        <div className="flex flex-col min-w-0 text-left">
          <span className="text-sm font-medium leading-none truncate text-sidebar-foreground">{user.name}</span>
          <span className={`text-[10px] mt-0.5 px-1.5 py-0.5 rounded-full inline-flex w-fit font-medium ${roleColor}`}>{roleLabel}</span>
        </div>
      </div>
      {/* Sign out button — always visible */}
      <button
        onClick={() => { logout(); setLocation("/login"); }}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-sidebar-foreground/60 hover:bg-red-500/10 hover:text-red-400 transition-colors"
      >
        <LogOut className="h-4 w-4 flex-shrink-0" />
        <span>Sign Out</span>
      </button>
    </div>
  );
}

function MobileMoreMenu({ location, onClose }: { location: string; onClose: () => void }) {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <div className="md:hidden fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <span className="font-semibold">Menu</span>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
      </div>
      <div className="p-4 flex flex-col gap-1 overflow-y-auto flex-1">
        {navGroups.map(group => <MobileNavGroup key={group.label} group={group} onClose={onClose} />)}
        <div className="mt-2 pt-4 border-t space-y-1">
          <Link href="/settings"><div onClick={onClose} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted"><Settings2 className="h-5 w-5" /><span className="font-medium text-sm">Settings</span></div></Link>
          <Link href="/owner-login"><div onClick={onClose} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted"><KeyRound className="h-5 w-5" /><span className="font-medium text-sm">Owner Portal</span></div></Link>
        </div>
      </div>
      {user && (
        <div className="p-4 border-t">
          <div className="flex items-center gap-3 px-2 py-2 mb-2">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
              {user.name.split(" ").map(n => n[0]).slice(0, 2).join("")}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">{user.name}</span>
              <span className="text-xs text-muted-foreground truncate">{user.email}</span>
            </div>
          </div>
          <button
            onClick={() => { logout(); setLocation("/login"); onClose(); }}
            className="w-full flex items-center gap-3 p-3 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

const OWNER_EMAIL = "clifford.landman@icloud.com";
const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const token = localStorage.getItem("ys_token");
    if (!token) return;
    const ping = () => {
      apiFetch(`${API_BASE}/api/session/ping`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    };
    ping();
    const id = setInterval(ping, 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex min-h-[100dvh] w-full bg-background text-foreground flex-col md:flex-row">
      <OnboardingWizard />
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-60 bg-sidebar text-sidebar-foreground flex-shrink-0 sticky top-0 h-screen border-r border-sidebar-border">
        <div className="px-4 pt-5 pb-4 border-b border-sidebar-border/30">
          <Link href="/dashboard">
            <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
              <img src={logoPath} alt="YallaStay Logo" className="h-10 w-10 flex-shrink-0" />
              <div>
                <div className="font-bold text-base tracking-tight leading-tight">YallaStay</div>
                <div className="text-[11px] text-sidebar-foreground/50 leading-tight">Holiday Homes</div>
              </div>
            </div>
          </Link>
          <div className="mt-3 bg-sidebar-accent/50 rounded-lg px-3 py-1.5">
            <p className="text-[11px] text-teal-400 font-semibold tracking-wide uppercase">Owners Come First</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-4">
          {navGroups.map(group => <NavGroup key={group.label} group={group} />)}
        </nav>

        <div className="p-3 border-t border-sidebar-border/50 space-y-1">
          {user?.email === OWNER_EMAIL && (
            <Link href="/analytics">
              <div className={`flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${location === "/analytics" ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-violet-400/80 hover:bg-sidebar-accent hover:text-violet-300"}`}>
                <Shield className="h-4 w-4 flex-shrink-0" /> <span>Analytics</span>
              </div>
            </Link>
          )}
          <Link href="/settings">
            <div className={`flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${location === "/settings" ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}>
              <Settings2 className="h-4 w-4 flex-shrink-0" /> <span>Settings</span>
            </div>
          </Link>
          <Link href="/owner-login">
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors">
              <KeyRound className="h-4 w-4 flex-shrink-0" /> <span>Owner Portal</span>
            </div>
          </Link>
          <UserMenu />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
        <header className="md:hidden flex items-center justify-between p-3 bg-sidebar text-sidebar-foreground sticky top-0 z-20 border-b border-sidebar-border/30">
          <Link href="/dashboard">
            <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
              <img src={logoPath} alt="YallaStay Logo" className="h-7 w-auto" />
              <span className="font-bold text-base tracking-tight">YallaStay</span>
            </div>
          </Link>
          <NotificationsBell />
        </header>
        <div className="hidden md:flex items-center justify-between gap-4 px-6 py-2 border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
          <CommandSearch/><NotificationsBell />
        </div>
        <div className="md:hidden p-3 border-b"><CommandSearch/></div>
        <div className="flex-1 min-w-0 overflow-auto bg-background p-3 md:p-5 pb-24 md:pb-5">{children}</div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav aria-label="Main" data-testid="bottom-nav" className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t grid grid-cols-5 items-stretch z-20 pb-safe shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
        {(["admin", "super_admin", "manager", "accountant"].includes(user?.role ?? "") ? BOTTOM_NAV : [...BOTTOM_NAV.slice(0, 3), { href: "/cleaning", icon: Sparkles, label: "Jobs" }]).map(item => {
          const active = item.href === "/income" ? location.startsWith("/income") : location === item.href;
          return (
            <Link key={item.label} href={item.href}>
              <div className={`flex flex-col items-center justify-center gap-1 h-16 ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                <item.icon className="h-6 w-6" />
                <span className="text-[11px] leading-none">{item.label}</span>
              </div>
            </Link>
          );
        })}
        <button onClick={() => setMobileMenuOpen(true)} aria-label="Open full menu" className="flex flex-col items-center justify-center gap-1 h-16 text-muted-foreground">
          <Menu className="h-6 w-6" />
          <span className="text-[11px] leading-none">More</span>
        </button>
      </nav>

      {/* Mobile More Menu */}
      {mobileMenuOpen && (
        <MobileMoreMenu location={location} onClose={() => setMobileMenuOpen(false)} />
      )}
    </div>
  );
}
