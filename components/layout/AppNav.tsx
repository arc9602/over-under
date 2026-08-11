"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserAvatarMenu } from "./UserAvatarMenu";
import { WalletButton } from "@/components/wallet/WalletButton";
import type { Profile } from "@/lib/types";

interface AppNavProps {
  profile: Profile;
}

export function AppNav({ profile }: AppNavProps) {
  const pathname = usePathname();

  const links = [
    { href: "/dashboard", label: "My Bets" },
    { href: "/markets", label: "Markets" },
    { href: "/balances", label: "Portfolio" },
  ];

  // The "+" button follows whichever section you're in.
  const inMarkets = pathname.startsWith("/markets");
  const newHref = inMarkets ? "/markets/new" : "/bets/new";
  const newLabel = inMarkets ? "+ New Market" : "+ New Bet";

  return (
    <header className="border-b border-border bg-card sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-xl font-black tracking-tight text-primary">
            OVER/UNDER
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  pathname.startsWith(link.href)
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <WalletButton />
          <Link
            href={newHref}
            className="hidden sm:flex items-center gap-1 bg-primary text-primary-foreground text-sm font-bold px-4 py-1.5 rounded hover:opacity-90 transition-opacity"
          >
            {newLabel}
          </Link>
          <UserAvatarMenu profile={profile} />
        </div>
      </div>
    </header>
  );
}
