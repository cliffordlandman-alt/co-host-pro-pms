import TaskCentre from "@/pages/task-centre";
import Guests from "@/pages/guests";
import VerifyBookings from "@/pages/verify-bookings";
import AirbnbImport from "@/components/AirbnbIncome";
import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { ThemeProvider } from "@/contexts/theme-context";
import NotFound from "@/pages/not-found";
import Dashboard from "@/components/today/TodayDashboard";
import Properties from "@/pages/properties";
import Calendar from "@/pages/calendar";
import MultiCalendar from "@/pages/multi-calendar";
import Reservations from "@/pages/reservations";
import ReservationDetail from "@/pages/reservation-detail";
import Cleaning from "@/pages/cleaning";
import Maintenance from "@/pages/maintenance";
import Owners from "@/pages/owners";
import Staff from "@/pages/staff";
import Payments from "@/pages/payments";
import Reports from "@/pages/reports";
import IncomePage from "@/pages/income";
import IncomePropertyPage from "@/pages/income-property";
import CalendarSyncPage from "@/pages/calendar-sync";
import CompliancePage from "@/pages/compliance";
import PayoutCheckPage from "@/pages/payout-check";
import Reviews from "@/pages/reviews";
import Inbox from "@/pages/inbox";
import Accounting from "@/pages/accounting";
import OwnerLogin from "@/pages/owner-login";
import OwnerPortal from "@/pages/owner-portal";
import Platforms from "@/pages/platforms";
import Automations from "@/pages/automations";
import Documents from "@/pages/documents";
import Subscriptions from "@/pages/subscriptions";
import Templates from "@/pages/templates";
import SettingsPage from "@/pages/settings";
import AIAssistant from "@/pages/ai-assistant";
import Pricing from "@/pages/pricing";
import AuditLog from "@/pages/audit-log";
import SystemHealth from "@/pages/system-health";
import SetupWizard from "@/pages/setup-wizard";
import OwnerAnalytics from "@/pages/owner-analytics";
import CleanerApp from "@/pages/cleaner-app";
import Devices from "@/pages/devices";
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import ForgotPasswordPage from "@/pages/forgot-password";
import { AppLayout } from "@/components/layout/app-layout";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();
window.addEventListener("pms-data-changed",()=>{void queryClient.invalidateQueries();});

function RedirectToDashboard() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/dashboard"); }, []);
  return null;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [loading, user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return null;
  return <>{children}</>;
}

function RequireOwner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  const hasAccess = user?.role === "admin" || user?.role === "super_admin";

  useEffect(() => {
    if (!loading && (!user || !hasAccess)) setLocation("/dashboard");
  }, [loading, user, hasAccess]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !hasAccess) return null;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && user) setLocation("/dashboard");
  }, [loading, user]);

  if (loading) return null;
  if (user) return null;
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login">
        <PublicRoute><LoginPage /></PublicRoute>
      </Route>
      <Route path="/signup">
        <PublicRoute><SignupPage /></PublicRoute>
      </Route>
      <Route path="/forgot-password">
        <PublicRoute><ForgotPasswordPage /></PublicRoute>
      </Route>
      <Route path="/owner-login" component={OwnerLogin} />
      <Route path="/owner-portal" component={OwnerPortal} />
      <Route path="/setup">
        <RequireAuth><SetupWizard /></RequireAuth>
      </Route>
      <Route>
        <RequireAuth>
          <AppLayout>
            <Switch>
              <Route path="/" component={RedirectToDashboard} />
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/task-centre" component={TaskCentre} />
              <Route path="/guests" component={Guests} />
              <Route path="/properties" component={Properties} />
              <Route path="/calendar" component={Calendar} />
              <Route path="/multi-calendar" component={MultiCalendar} />
              <Route path="/reservations" component={Reservations} />
              <Route path="/reservations/:id" component={ReservationDetail} />
              <Route path="/cleaning" component={Cleaning} />
              <Route path="/maintenance" component={Maintenance} />
              <Route path="/owners" component={Owners} />
              <Route path="/staff" component={Staff} />
              <Route path="/payments" component={Payments} />
              <Route path="/reports" component={Reports} />
              <Route path="/income" component={IncomePage} />
              <Route path="/income/:id" component={IncomePropertyPage} />
              <Route path="/calendar-sync" component={CalendarSyncPage} />
              <Route path="/compliance" component={CompliancePage} />
              <Route path="/payout-check" component={PayoutCheckPage} />
              <Route path="/reviews" component={Reviews} />
              <Route path="/inbox" component={Inbox} />
              <Route path="/airbnb-import" component={AirbnbImport} />
              <Route path="/accounting" component={Accounting} />
              <Route path="/verify-bookings" component={VerifyBookings} />
              <Route path="/platforms" component={Platforms} />
              <Route path="/automations" component={Automations} />
              <Route path="/documents" component={Documents} />
              <Route path="/subscriptions">
                <RequireOwner><Subscriptions /></RequireOwner>
              </Route>
              <Route path="/templates" component={Templates} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/ai-assistant" component={AIAssistant} />
              <Route path="/pricing" component={Pricing} />
              <Route path="/audit-log">
                <RequireOwner><AuditLog /></RequireOwner>
              </Route>
              <Route path="/system-health">
                <RequireOwner><SystemHealth /></RequireOwner>
              </Route>
              <Route path="/devices" component={Devices} />
              <Route path="/analytics">
                <RequireOwner><OwnerAnalytics /></RequireOwner>
              </Route>
              <Route path="/cleaner-app">
                <RequireAuth>
                  <CleanerApp />
                </RequireAuth>
              </Route>
              <Route component={NotFound} />
            </Switch>
          </AppLayout>
        </RequireAuth>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
