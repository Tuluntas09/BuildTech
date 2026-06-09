import { NavLink, Outlet, useLocation } from "react-router-dom";
import { DataFreshness } from "./DataFreshness/DataFreshness";
import { DisclaimerFooter } from "./DisclaimerFooter/DisclaimerFooter";

// ---- Inline SVG icons ---------------------------------------------------
function LayersIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
      <polyline points="2 17 12 22 22 17"/>
      <polyline points="2 12 12 17 22 12"/>
    </svg>
  );
}

function BookmarkIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

function SlidersIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
      <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
      <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/>
      <line x1="17" y1="16" x2="23" y2="16"/>
    </svg>
  );
}

function ClockIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function SettingsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

// ---- Nav config ---------------------------------------------------------
type NavEntry = {
  to: string;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
};

const NAV_MAIN: NavEntry[] = [
  { to: "/universe",  label: "Universe",  Icon: LayersIcon   },
  { to: "/watchlist", label: "Watchlist", Icon: BookmarkIcon },
  { to: "/builder",   label: "Builder",   Icon: SlidersIcon  },
  { to: "/history",   label: "History",   Icon: ClockIcon    },
];

const PAGE_META: Record<string, { title: string; sub: string }> = {
  "/universe":  { title: "Universe Explorer", sub: "Scored assets" },
  "/watchlist": { title: "Watchlist",          sub: "Candidate assets" },
  "/builder":   { title: "Builder",            sub: "Construct portfolios" },
  "/history":   { title: "History",            sub: "Saved outputs" },
  "/settings":  { title: "Settings",           sub: "Profile & preferences" },
};

// ---- Reusable nav item --------------------------------------------------
function NavItem({ to, label, Icon }: NavEntry) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "8px 10px",
        marginBottom: 2,
        borderRadius: "var(--radius-sm)",
        fontSize: 13.5,
        fontWeight: 500,
        cursor: "pointer",
        whiteSpace: "nowrap" as const,
        textDecoration: "none",
        transition: "background 0.12s, color 0.12s",
        border: "1px solid",
        background:    isActive ? "var(--indigo-soft)" : "transparent",
        borderColor:   isActive ? "rgba(99,102,241,0.25)" : "transparent",
        color:         isActive ? "var(--text)" : "var(--muted)",
      })}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        if (!el.getAttribute("aria-current")) {
          el.style.background = "var(--elevated)";
          el.style.color = "var(--text-2)";
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        if (!el.getAttribute("aria-current")) {
          el.style.background = "transparent";
          el.style.color = "var(--muted)";
        }
      }}
    >
      {({ isActive }) => (
        <>
          <span style={{ color: isActive ? "var(--indigo)" : "currentColor", flexShrink: 0, display: "flex" }}>
            <Icon size={18} />
          </span>
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

// ---- AppLayout ----------------------------------------------------------
export function AppLayout() {
  const location = useLocation();
  const meta = PAGE_META[location.pathname] ?? { title: "BuildTech", sub: "" };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)", color: "var(--text)" }}>

      {/* ---- Sidebar ---- */}
      <aside
        className="flex-shrink-0 flex flex-col overflow-hidden z-20"
        style={{ width: 220, background: "var(--surface)", borderRight: "1px solid var(--border)" }}
      >
        {/* Brand */}
        <div
          className="flex items-center gap-3 flex-shrink-0"
          style={{ height: 56, padding: "0 18px", borderBottom: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 26, height: 26,
              borderRadius: 7,
              background: "linear-gradient(135deg, var(--indigo), #818cf8)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset, 0 4px 12px -2px var(--indigo-glow)",
            }}
          >
            <LayersIcon size={14} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>
            Build<span style={{ color: "var(--indigo)" }}>Tech</span>
          </span>
        </div>

        {/* Main nav */}
        <nav className="flex-1 flex flex-col" style={{ padding: "14px 10px 0" }}>
          <p style={{
            fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em",
            textTransform: "uppercase", color: "var(--muted-2)",
            padding: "0 10px 8px",
          }}>
            Workspace
          </p>
          {NAV_MAIN.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>

        {/* Account nav */}
        <div style={{ padding: "12px 10px", borderTop: "1px solid var(--border)" }}>
          <p style={{
            fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em",
            textTransform: "uppercase", color: "var(--muted-2)",
            padding: "0 10px 8px",
          }}>
            Account
          </p>
          <NavItem to="/settings" label="Settings" Icon={SettingsIcon} />
        </div>
      </aside>

      {/* ---- Main column ---- */}
      <div className="flex flex-1 flex-col min-w-0" style={{ background: "var(--bg)" }}>

        {/* Topbar */}
        <header
          className="flex-shrink-0 flex items-center gap-3.5"
          style={{
            height: 56,
            padding: "0 20px",
            borderBottom: "1px solid var(--border)",
            backdropFilter: "blur(12px)",
            background: "color-mix(in srgb, #0A0B0F 85%, transparent)",
          }}
        >
          <div className="flex items-baseline gap-2.5 min-w-0 overflow-hidden flex-shrink">
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 650, letterSpacing: "-0.02em", color: "var(--text)", whiteSpace: "nowrap" }}>
              {meta.title}
            </h1>
            {meta.sub && (
              <span style={{ fontSize: 13, color: "var(--muted-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                / {meta.sub}
              </span>
            )}
          </div>

          <div className="flex-1" />

          <DataFreshness />

          <div style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "8px 2px" }} />

          {/* Profile pill */}
          <div
            className="flex items-center gap-2 cursor-pointer"
            style={{
              background: "var(--indigo-soft)",
              border: "1px solid rgba(99,102,241,0.28)",
              borderRadius: 20,
              padding: "4px 5px 4px 11px",
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--text)",
            }}
          >
            Profile
            <span
              className="flex items-center justify-center"
              style={{
                width: 22, height: 22, borderRadius: "50%",
                background: "linear-gradient(135deg, var(--indigo), #818cf8)",
              }}
            >
              <UserIcon />
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>

        <DisclaimerFooter />
      </div>
    </div>
  );
}
