"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MobileBottomNav() {
  const pathname = usePathname();

  const links = [
    {
      href: "/dashboard",
      // Bets also live at /bets/<id> -- match both prefixes so browsing a bet keeps this tab lit.
      matchPrefixes: ["/dashboard", "/bets"],
      label: "Bets",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
    },
    {
      href: "/markets",
      matchPrefixes: ["/markets"],
      label: "Markets",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" />
        </svg>
      ),
    },
    {
      href: "/new",
      // Exact match, not prefix -- otherwise this tab would stay lit on /bets/new and /markets/new.
      exact: true,
      label: "New",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
            d="M12 4v16m8-8H4" />
        </svg>
      ),
      // Centre slot of five is the thumb-reachable spot for a primary action.
      primary: true,
    },
    {
      href: "/friends",
      matchPrefixes: ["/friends"],
      label: "Friends",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H2v-2a4 4 0 014-4h3m8-4a3 3 0 100-6 3 3 0 000 6zM9 12a4 4 0 100-8 4 4 0 000 8zm6 8v-2a6 6 0 00-12 0v2" />
        </svg>
      ),
    },
    {
      href: "/balances",
      matchPrefixes: ["/balances"],
      label: "Portfolio",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
        </svg>
      ),
    },
  ];

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex">
        {links.map((link) => {
          const active = link.exact
            ? pathname === link.href
            : (link.matchPrefixes?.some((prefix) => pathname.startsWith(prefix)) ?? false);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                link.primary
                  ? "text-primary"
                  : active
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {link.icon}
              <span className="text-[10px] font-medium">{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
