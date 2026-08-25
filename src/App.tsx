import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, type ComponentType } from "react";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "./contexts/AuthContext.tsx";

// Only the new application surfaces are part of the shell. Legacy Studio and
// Admin pages are deliberately not imported, so they cannot ship or re-enter
// the product through a client-side route.
/**
 * Vercel deployments have immutable hashed chunks.  A long-open tab can keep
 * the previous router bundle after a release, then fail when it lazily asks
 * for a chunk that belonged to the previous deployment.  Reload exactly once
 * into the current deployment rather than leaving a customer on stale UI.
 */
function lazyCurrentRelease<T extends ComponentType<unknown>>(loader: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const loaded = await loader();
      if (typeof window !== "undefined") sessionStorage.removeItem("fusionlab:lazy-release-reload");
      return loaded;
    } catch (error) {
      if (typeof window !== "undefined" && !sessionStorage.getItem("fusionlab:lazy-release-reload")) {
        sessionStorage.setItem("fusionlab:lazy-release-reload", "1");
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      throw error;
    }
  });
}

const AuthPage = lazyCurrentRelease(() => import("./pages/AuthPage.tsx"));
const AdminV2Page = lazyCurrentRelease(() => import("./pages/AdminV2Page.tsx"));
const AdminShell = lazyCurrentRelease(() => import("./features/admin/AdminShell.tsx"));
const AdminDashboardPage = lazyCurrentRelease(() => import("./features/admin/pages/AdminDashboardPage.tsx"));
const AdminUsersPage = lazyCurrentRelease(() => import("./features/admin/pages/AdminUsersPage.tsx"));
const AdminSubscriptionsPage = lazyCurrentRelease(() => import("./features/admin/pages/AdminSubscriptionsPage.tsx"));
const AdminProvidersPage = lazyCurrentRelease(() => import("./features/admin/pages/AdminProvidersPage.tsx"));
const AdminModelsPage = lazyCurrentRelease(() => import("./features/admin/pages/AdminModelsPage.tsx"));
const AdminPricingPage = lazyCurrentRelease(() => import("./features/admin/pages/AdminPricingPage.tsx"));
const AdminOperationsPage = lazyCurrentRelease(() => import("./features/admin/pages/AdminOperationsPage.tsx"));
const AdminReportsPage = lazyCurrentRelease(() => import("./features/admin/pages/AdminReportsPage.tsx"));
const AdminSettingsPage = lazyCurrentRelease(() => import("./features/admin/pages/AdminSettingsPage.tsx"));
const AdminAdvancedPage = lazyCurrentRelease(() => import("./features/admin/pages/AdminAdvancedPage.tsx"));
const CreativeSpacePage = lazyCurrentRelease(() => import("./pages/CreativeSpacePage.tsx"));
const StandardPrototypePage = lazyCurrentRelease(() => import("./features/creative-space/StandardPrototypePage.tsx"));
const StandardImageWorkspacePage = lazyCurrentRelease(() => import("./pages/StandardImageWorkspacePage.tsx"));
const ProjectsPage = lazyCurrentRelease(() => import("./pages/ProjectsPage.tsx"));
const ProfilePage = lazyCurrentRelease(() => import("./pages/ProfilePage.tsx"));
const NotFound = lazyCurrentRelease(() => import("./pages/NotFound.tsx"));

const queryClient = new QueryClient();

const PROJECTS_PATH = "/projects";

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return children;
};

const RouteLoading = () => (
  <div className="min-h-screen bg-background flex items-center justify-center text-sm text-muted-foreground">
    Loading workspace...
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Navigate to={PROJECTS_PATH} replace />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route
                path="/admin"
                element={import.meta.env.DEV ? <AdminShell /> : <RequireAuth><AdminShell /></RequireAuth>}
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboardPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="users/:userId" element={<AdminUsersPage />} />
                <Route path="subscriptions" element={<AdminSubscriptionsPage />} />
                <Route path="subscriptions/plans/:planId" element={<AdminSubscriptionsPage />} />
                <Route path="providers" element={<AdminProvidersPage />} />
                <Route path="providers/:providerId" element={<AdminProvidersPage />} />
                <Route path="models" element={<AdminModelsPage />} />
                <Route path="models/:modelId" element={<AdminModelsPage />} />
                <Route path="pricing" element={<AdminPricingPage />} />
                <Route path="pricing/:offerId" element={<AdminPricingPage />} />
                <Route path="operations" element={<AdminOperationsPage />} />
                <Route path="operations/:operationId" element={<AdminOperationsPage />} />
                <Route path="reports" element={<AdminReportsPage />} />
                <Route path="settings" element={<AdminSettingsPage />} />
                <Route path="advanced/*" element={<AdminAdvancedPage />} />
              </Route>
              {/* The old technical reader is isolated and never owns a primary Admin URL. */}
              <Route path="/admin/advanced/legacy-control-plane" element={<AdminV2Page />} />
              <Route path="/admin/v2" element={<Navigate to="/admin/advanced" replace />} />
              <Route
                path="/projects"
                element={import.meta.env.DEV ? <ProjectsPage /> : <RequireAuth><ProjectsPage /></RequireAuth>}
              />
              <Route
                path="/projects/:projectId/studio"
                element={import.meta.env.DEV ? <CreativeSpacePage /> : <RequireAuth><CreativeSpacePage /></RequireAuth>}
              />
              <Route
                path="/projects/:projectId/standard-prototype"
                element={import.meta.env.DEV ? <StandardPrototypePage /> : <RequireAuth><StandardPrototypePage /></RequireAuth>}
              />
              <Route
                path="/projects/:projectId/standard"
                element={import.meta.env.DEV ? <StandardImageWorkspacePage /> : <RequireAuth><StandardImageWorkspacePage /></RequireAuth>}
              />
              {/* Retired product routes are one-way redirects; no legacy UI is mounted. */}
              <Route path="/studio/*" element={<Navigate to={PROJECTS_PATH} replace />} />
              <Route path="/tool/*" element={<Navigate to={PROJECTS_PATH} replace />} />
              <Route path="/profile" element={import.meta.env.DEV ? <ProfilePage /> : <RequireAuth><ProfilePage /></RequireAuth>} />
              <Route path="/pricing" element={<Navigate to={PROJECTS_PATH} replace />} />
              <Route path="/library" element={<Navigate to={PROJECTS_PATH} replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
