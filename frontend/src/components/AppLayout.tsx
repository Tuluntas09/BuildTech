import { NavLink, Outlet } from "react-router-dom";
import { DataFreshness } from "./DataFreshness/DataFreshness";
import { DisclaimerFooter } from "./DisclaimerFooter/DisclaimerFooter";

const NAV_LINKS = [
  { to: "/universe",  label: "Universe" },
  { to: "/watchlist", label: "Watchlist" },
  { to: "/builder",   label: "Builder" },
  { to: "/history",   label: "History" },
  { to: "/settings",  label: "Settings" },
];

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-48 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100">
          <span className="text-base font-bold tracking-tight text-brand-600">
            BuildTech
          </span>
        </div>
        <nav className="flex-1 py-4 px-2 flex flex-col gap-1">
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "block rounded px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-50 text-brand-600"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                ].join(" ")
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Topbar */}
        <header className="h-12 flex-shrink-0 border-b border-gray-200 bg-white flex items-center justify-end px-6">
          <DataFreshness />
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
