import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import { getProfile } from "./api/client";
import { AppLayout } from "./components/AppLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Onboarding } from "./pages/Onboarding/Onboarding";
import { Universe } from "./pages/Universe/Universe";
import { Watchlist } from "./pages/Watchlist/Watchlist";
import { Builder } from "./pages/Builder/Builder";
import { History } from "./pages/History/History";
import { Settings } from "./pages/Settings/Settings";

function PageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</p>
    </div>
  );
}

function ProfileGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    getProfile()
      .then((profile) => {
        if (profile === null) {
          navigate("/onboarding", { replace: true });
        }
      })
      .catch(() => {
        // Backend unreachable — let the child pages handle the error themselves
      })
      .finally(() => {
        setChecked(true);
      });
  }, [navigate]);

  if (!checked) return <PageLoading />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route
            element={
              <ProfileGuard>
                <AppLayout />
              </ProfileGuard>
            }
          >
            <Route index element={<Navigate to="/universe" replace />} />
            <Route path="/universe" element={<Universe />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/builder" element={<Builder />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/universe" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
