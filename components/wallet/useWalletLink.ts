"use client";

import { useCallback, useEffect, useState } from "react";
import { useSignMessage } from "wagmi";

import { createClient } from "@/lib/supabase/client";
import { buildWalletLinkMessage } from "@/lib/validation/wallet";

/**
 * The client half of wallet linking.
 *
 * A wallet has to be linked before it can deposit or withdraw: /api/wallet/deposit
 * credits a deposit only when the Transfer log's `from` matches the linked
 * address, and /api/wallet/withdraw pays out only to it. So an unlinked wallet
 * is not a degraded state, it is a non-functional one, and the UI has to say so
 * rather than letting a user discover it after they have already sent funds.
 *
 * The message is built by buildWalletLinkMessage rather than composed here.
 * That is not tidiness: the route re-parses the message and checks it field by
 * field, so signer and verifier must agree byte for byte. Two hand-written
 * copies of the same string is a bug waiting for someone to fix a typo on one
 * side and silently break linking for everyone.
 */

type LinkState = {
  /** The address currently linked to this account, lowercased, or null. */
  linkedAddress: string | null;
  loading: boolean;
  linking: boolean;
  /** True when the connected wallet is the one on file. */
  isLinked: boolean;
  /** Someone else's wallet is on file -- linking this one will be rejected. */
  isMismatched: boolean;
  link: () => Promise<void>;
};

export function useWalletLink(connectedAddress: string | undefined): LinkState {
  const [linkedAddress, setLinkedAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const { signMessageAsync } = useSignMessage();

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLinkedAddress(null);
      setLoading(false);
      return;
    }

    // Read through the user's own client, not an API route. wallet_links is
    // RLS-scoped to auth.uid(), so this can only ever return their own row --
    // no endpoint needed, and no way to probe someone else's link.
    const { data } = await supabase
      .from("wallet_links")
      .select("address")
      .eq("user_id", user.id)
      .maybeSingle();

    setLinkedAddress(data?.address ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const link = useCallback(async () => {
    if (!connectedAddress) throw new Error("Connect a wallet first");

    setLinking(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be signed in");

      const address = connectedAddress.toLowerCase();
      // issuedAt is stamped client-side and checked server-side against a
      // 10-minute window, with a small allowance for a clock running fast. A
      // machine whose clock is badly wrong will fail here rather than mint a
      // signature that stays valid indefinitely.
      const message = buildWalletLinkMessage({
        address,
        userId: user.id,
        issuedAt: new Date(),
        nonce: crypto.randomUUID(),
      });

      const signature = await signMessageAsync({ message });

      const response = await fetch("/api/wallet/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature, message }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not link that wallet");
      }

      await refresh();
    } finally {
      setLinking(false);
    }
  }, [connectedAddress, refresh, signMessageAsync]);

  const normalized = connectedAddress?.toLowerCase();

  return {
    linkedAddress,
    loading,
    linking,
    isLinked: Boolean(normalized && linkedAddress === normalized),
    isMismatched: Boolean(normalized && linkedAddress && linkedAddress !== normalized),
    link,
  };
}
