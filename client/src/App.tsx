import { Switch, Route, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { ErrorPage } from "@/pages/error-page";
import { OfflinePage } from "@/pages/offline";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { ThemeController } from "@/hooks/use-theme-controller";
import { Component, Suspense, lazy, type ReactNode } from "react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { EditorLoadingScreen } from "@/components/EditorLoadingScreen";
import { Analytics as VercelAnalytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

/* ── Eager (critical path, small) ── */
import LoginPage from "@/pages/Login";
import SignUpPage from "@/pages/SignUp";
import { AppLayout } from "@/components/AppLayout";

/* ── Page imports ── */
import Landing from "@/pages/Landing";
import Product from "@/pages/Product";
import Pricing from "@/pages/Pricing";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import Docs from "@/pages/Docs";
import Affiliate from "@/pages/Affiliate";
import MarketingContact from "@/pages/MarketingContact";
import MarketingStatus from "@/pages/MarketingStatus";
import VerifyEmailPage from "@/pages/VerifyEmail";
import ForgotPasswordPage from "@/pages/ForgotPassword";
import ResetPasswordPage from "@/pages/ResetPassword";
import LoadingVerificationPage from "@/pages/LoadingVerification";

/* ── Lazy (code-split, loaded on demand + prefetched after sign-in) ── */
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const CompleteGithubSignup = lazy(() => import("@/pages/CompleteGithubSignup"));
const HomePage = lazy(() => import("@/pages/HomePage"));
const CanvasPage = lazy(() => import("@/pages/CanvasPage"));
const ProjectsPage = lazy(() => import("@/pages/ProjectsPage"));
const ComponentsPage = lazy(() => import("@/pages/ComponentsPage"));
const AssetsPage = lazy(() => import("@/pages/AssetsPage"));
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const AdminPage = lazy(() => import("@/pages/Admin"));
const Account = lazy(() => import("@/pages/Account"));
const WorkspacePage = lazy(() => import("@/pages/TeamPage"));
const TeamPage = lazy(() => import("@/pages/TeamPage"));
const InviteAccept = lazy(() => import("@/pages/InviteAccept"));

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return <ErrorPage />;
    }
    return this.props.children;
  }
}

/* ── Offline gate ── */
function OfflineGate({ children }: { children: ReactNode }) {
  const { isOnline } = useNetworkStatus();
  if (!isOnline) return <OfflinePage />;
  return <>{children}</>;
}

/* ── Design app layout ── */
function DesignAppLayout({ children }: { children: ReactNode }) {
  return (
    <AppLayout>
      {children}
    </AppLayout>
  );
}

/* ── Router ── */
function Router() {
  return (
    <>
      <ThemeController />
      {/* Lazy page chunks: app-shell pages are caught by the Suspense
          inside AppLayout; full-screen pages (canvas, admin) fall back
          to a minimal spinner here. Chunks are warm-prefetched post-login. */}
      <Suspense fallback={<EditorLoadingScreen />}>
      <Switch>
      {/* Public */}
      <Route path="/" component={Landing} />
      <Route path="/product" component={Product} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/auth/login" component={LoginPage} />
      <Route path="/auth/signup" component={SignUpPage} />
      <Route path="/auth/verify-email" component={VerifyEmailPage} />
      <Route path="/auth/complete-signup">
        {() => <ProtectedRoute component={CompleteGithubSignup} />}
      </Route>
      <Route path="/auth/forgot-password" component={ForgotPasswordPage} />
      <Route path="/auth/reset-password" component={ResetPasswordPage} />
      <Route path="/auth/loading-verification" component={LoadingVerificationPage} />
      <Route path="/auth/onboarding">
        {() => <ProtectedRoute component={Onboarding} />}
      </Route>
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/docs" component={Docs} />
      <Route path="/contact" component={MarketingContact} />
      <Route path="/affiliate" component={Affiliate} />
      <Route path="/status" component={MarketingStatus} />

      {/* Dashboard */}
      <Route path="/home">{() => <ProtectedRoute component={() => <DesignAppLayout><HomePage /></DesignAppLayout>} />}</Route>
      <Route path="/canvas/:id">{() => <ProtectedRoute component={CanvasPage} />}</Route>
      <Route path="/home/projects">{() => <ProtectedRoute component={() => <DesignAppLayout><ProjectsPage /></DesignAppLayout>} />}</Route>
      <Route path="/home/components">{() => <ProtectedRoute component={() => <DesignAppLayout><ComponentsPage /></DesignAppLayout>} />}</Route>
      <Route path="/home/assets">{() => <ProtectedRoute component={() => <DesignAppLayout><AssetsPage /></DesignAppLayout>} />}</Route>

      <Route path="/account">{() => <Redirect to="/account/profile" />}</Route>
      <Route path="/account/*?">{() => <ProtectedRoute component={() => <AppLayout><Account /></AppLayout>} />}</Route>
      <Route path="/workspace">{() => <Redirect to="/workspace/team" />}</Route>
      <Route path="/workspace/team">{() => <ProtectedRoute component={() => <AppLayout><TeamPage /></AppLayout>} />}</Route>
      <Route path="/workspace/*?">{() => <ProtectedRoute component={() => <AppLayout><WorkspacePage /></AppLayout>} />}</Route>
      <Route path="/invite/:token" component={InviteAccept} />

      {/* Admin */}
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/admin" component={AdminPage} />

      <Route component={NotFound} />
    </Switch>
    </Suspense>
    </>
  );
}

/* ── App ── */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <TooltipProvider>
          <Toaster />
          <OfflineGate>
            <WorkspaceProvider>
              <Router />
            </WorkspaceProvider>
          </OfflineGate>
        </TooltipProvider>
      </ErrorBoundary>
      <VercelAnalytics />
      <SpeedInsights />
    </QueryClientProvider>
  );
}

export default App;
