"use client";

/**
 * Header wallet affordance: address, wallet kind, live USDC balance, deposit.
 *
 * Split into an outer gate and an inner component on purpose. usePrivy() and
 * every wagmi hook throw when no provider is mounted, and WalletProvider
 * deliberately mounts nothing when chain env is blank -- so the hooks have to
 * live in a component that is never rendered in that case. A conditional
 * `if (!configured) return` inside a single component would also work today,
 * but only because the flag is build-time constant; this shape doesn't depend
 * on that being true.
 */

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { polygonAmoy } from "viem/chains";
import { toast } from "sonner";
import { CopyIcon, WalletIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { getUsdcAddress, isChainConfigured } from "@/lib/chain/env";
import { usdcAbi } from "@/lib/chain/usdc";
import { displayUsdc } from "@/lib/chain/amount";
import { DepositModal } from "./DepositModal";

/** 0x1234abcd… -> 0x1234…abcd. Purely presentational. */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
  if (!isChainConfigured()) {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1.5 rounded border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground"
        title="Set NEXT_PUBLIC_PRIVY_APP_ID, NEXT_PUBLIC_USDC_CONTRACT_ADDRESS and NEXT_PUBLIC_VAULT_ADDRESS in .env.local to enable the wallet."
      >
        <WalletIcon className="size-3.5" />
        Wallet not configured
      </span>
    );
  }
  return <ConnectedWalletButton />;
}

function ConnectedWalletButton() {
  const { ready, authenticated, login, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const { address, isConnected } = useAccount();
  const [depositOpen, setDepositOpen] = useState(false);

  const {
    data: balanceUnits,
    isLoading: balanceLoading,
    isError: balanceError,
  } = useReadContract({
    address: getUsdcAddress(),
    abi: usdcAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: polygonAmoy.id,
    query: {
      enabled: Boolean(address),
      // The header balance is the only place a user sees a deposit land, so
      // it polls rather than waiting for a navigation.
      refetchInterval: 15_000,
    },
  });

  if (!ready) {
    return <div className="h-7 w-28 animate-pulse rounded bg-secondary" aria-hidden />;
  }

  if (!authenticated || !isConnected || !address) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => (authenticated ? connectWallet() : login())}
        className="font-medium"
      >
        <WalletIcon />
        Connect wallet
      </Button>
    );
  }

  // Privy exposes the embedded wallet with walletClientType 'privy' (or
  // 'privy-v2' after migration). Anything else came from the browser or
  // WalletConnect and is the user's own.
  const active = wallets.find((w) => w.address.toLowerCase() === address.toLowerCase());
  const isEmbedded =
    active?.walletClientType === "privy" ||
    active?.walletClientType === "privy-v2" ||
    active?.connectorType === "embedded";
  const walletKind = active ? (isEmbedded ? "Embedded wallet" : "External wallet") : "Wallet";

  const balanceLabel = balanceError
    ? "—"
    : balanceLoading || balanceUnits === undefined
      ? "…"
      : displayUsdc(balanceUnits);

  async function handleCopy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Could not copy address");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="font-medium tabular-nums" />
          }
        >
          <WalletIcon />
          <span className="hidden sm:inline">{truncateAddress(address)}</span>
          <span className="text-muted-foreground">·</span>
          <span>${balanceLabel}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <div className="px-2 py-1.5">
            <p className="text-xs text-muted-foreground">{walletKind}</p>
            <p className="font-mono text-sm break-all">{truncateAddress(address)}</p>
            <p className="mt-2 text-xs text-muted-foreground">USDC balance</p>
            <p className="text-sm font-bold tabular-nums">
              {balanceError ? "Unavailable" : `$${balanceLabel}`}
            </p>
            <p className="text-xs text-muted-foreground">Polygon Amoy testnet</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopy} className="cursor-pointer">
            <CopyIcon className="size-3.5" />
            Copy address
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setDepositOpen(true)}
            className="cursor-pointer font-medium"
          >
            Deposit USDC
          </DropdownMenuItem>
          {!isEmbedded && (
            <DropdownMenuItem onClick={() => connectWallet()} className="cursor-pointer">
              Switch wallet
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DepositModal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        walletBalanceUnits={balanceUnits}
      />
    </>
  );
}
