import { useEffect, useState } from "react";
import { Outlet, createRootRoute, Link, useRouterState, useRouter } from "@tanstack/react-router";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { AppBreadcrumb } from "@/components/AppBreadcrumb";
import { Toaster } from "@/components/ui/sonner";
import { getToken } from "@/lib/api";
import { ThemeProvider } from "@/context/ThemeContext";
import { UserProvider } from "@/context/UserContext";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function SessionExpiredModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-500">
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        </div>
        <h2 className="mt-3 text-[15px] font-semibold text-foreground">Session expired</h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Your session has expired. Please sign in again to continue.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 flex h-9 w-full items-center justify-center rounded-xl bg-neutral-900 text-[13px] font-semibold text-white transition-colors hover:bg-neutral-800"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}

function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const isLogin = pathname === "/login";
  const [sessionExpired, setSessionExpired] = useState(false);

  // Redirect to login if no token and not on login page
  useEffect(() => {
    if (!isLogin && !getToken()) {
      router.navigate({ to: "/login" });
    }
  }, [pathname, isLogin, router]);

  // Listen for 401 events from API layer
  useEffect(() => {
    const handler = () => setSessionExpired(true);
    window.addEventListener("sebi:session-expired", handler);
    return () => window.removeEventListener("sebi:session-expired", handler);
  }, []);

  const handleSessionModalClose = () => {
    setSessionExpired(false);
    router.navigate({ to: "/login" });
  };

  if (isLogin) {
    return (
      <>
        <Outlet />
        <Toaster />
      </>
    );
  }

  // While token check redirects, don't flash the shell
  if (!getToken()) return null;

  return (
    <ThemeProvider>
      <UserProvider>
        <div className="h-screen w-screen flex overflow-hidden bg-[var(--shell-bg)]">
          <AppSidebar />
          <div className="flex-1 min-w-0 flex flex-col bg-background border-l border-border overflow-hidden">
            <AppHeader />
            <AppBreadcrumb />
            <main className="flex-1 overflow-y-auto px-6 pt-4 pb-6">
              <Outlet />
            </main>
            <Toaster />
          </div>
          {sessionExpired && <SessionExpiredModal onClose={handleSessionModalClose} />}
        </div>
      </UserProvider>
    </ThemeProvider>
  );
}
