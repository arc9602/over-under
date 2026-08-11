"use client";

/**
 * Deposit flow: user's wallet -> platform vault, as a plain ERC-20 transfer.
 *
 * Three steps, strictly sequential, because each one can fail in a way the
 * user needs to see distinctly:
 *
 *   1. transfer()      -- wallet prompt; user can reject.
 *   2. wait receipt    -- can revert on-chain (insufficient balance, etc).
 *   3. POST the hash   -- the server credits the ledger from the receipt.
 *
 * Step 3 is deliberately not optimistic. The transaction hash is the only
 * thing the client is trusted with; the server re-reads the receipt and
 * decodes the Transfer log itself before crediting anything. If step 3 fails
 * after step 2 succeeded, the money is already in the vault and only the
 * credit is missing -- so the error message says exactly that, with the hash,
 * rather than implying the deposit was lost.
 *
 * No approve/allowance step: the vault never pulls funds, the user pushes them.
 */

import { useState } from "react";
import { useAccount, useConfig, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { polygonAmoy } from "viem/chains";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getUsdcAddress, getVaultAddress } from "@/lib/chain/env";
import { usdcAbi } from "@/lib/chain/usdc";
import { AmountError, displayUsdc, formatUsdc, parseUsdc } from "@/lib/chain/amount";

interface DepositModalProps {
  open: boolean;
  onClose: () => void;
  /** On-chain USDC balance in base units, when the header has already read it. */
  walletBalanceUnits?: bigint;
}

export function DepositModal({ open, onClose, walletBalanceUnits }: DepositModalProps) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const config = useConfig();
  const queryClient = useQueryClient();

  const wrongChain = chainId !== undefined && chainId !== polygonAmoy.id;

  async function handleDeposit() {
    if (!address) {
      toast.error("Connect a wallet first");
      return;
    }

    // parseUsdc is the only sanctioned decimal -> base-units conversion, and
    // it rejects anything finer than 6 places rather than silently truncating.
    let units: bigint;
    try {
      units = parseUsdc(amount);
    } catch (error) {
      toast.error(
        error instanceof AmountError ? error.message : "Enter a valid USDC amount"
      );
      return;
    }

    if (units <= BigInt(0)) {
      toast.error("Enter an amount greater than zero");
      return;
    }
    if (walletBalanceUnits !== undefined && units > walletBalanceUnits) {
      toast.error(`Your wallet only holds $${displayUsdc(walletBalanceUnits)} USDC`);
      return;
    }

    setBusy(true);
    const toastId = toast.loading("Confirm the transfer in your wallet…");

    try {
      if (wrongChain) {
        toast.loading("Switching to Polygon Amoy…", { id: toastId });
        await switchChainAsync({ chainId: polygonAmoy.id });
        toast.loading("Confirm the transfer in your wallet…", { id: toastId });
      }

      const hash = await writeContractAsync({
        address: getUsdcAddress(),
        abi: usdcAbi,
        functionName: "transfer",
        args: [getVaultAddress(), units],
        chainId: polygonAmoy.id,
      });

      toast.loading("Waiting for confirmation…", { id: toastId });

      const receipt = await waitForTransactionReceipt(config, {
        hash,
        chainId: polygonAmoy.id,
      });

      if (receipt.status !== "success") {
        toast.error("The transfer reverted on-chain. Nothing was deposited.", {
          id: toastId,
        });
        return;
      }

      toast.loading("Crediting your balance…", { id: toastId });

      const response = await fetch("/api/wallet/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Amounts cross this boundary as a decimal string, never a float.
        body: JSON.stringify({ transactionHash: hash, amount: formatUsdc(units) }),
      });

      const result = (await response.json().catch(() => null)) as
        | { ok?: true; error?: string }
        | null;

      if (!response.ok || result?.error) {
        toast.error(
          `Transfer confirmed but crediting failed: ${result?.error ?? response.statusText}. ` +
            `Your funds are safe; reference tx ${hash.slice(0, 10)}…`,
          { id: toastId, duration: 12_000 }
        );
        return;
      }

      toast.success(`Deposited $${displayUsdc(units)} USDC`, { id: toastId });
      setAmount("");
      // Re-read the header balance and anything else keyed off chain state.
      await queryClient.invalidateQueries();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deposit failed";
      // Wallet rejections are the common case and are not worth a scary error.
      const rejected = /user rejected|denied|rejected the request/i.test(message);
      if (rejected) {
        toast.error("Transfer cancelled", { id: toastId });
      } else {
        toast.error(message.split("\n")[0], { id: toastId });
      }
    } finally {
      setBusy(false);
    }
  }

  function handleOpenChange(next: boolean) {
    // Closing mid-transaction would orphan the pending toast and leave the
    // user with no way back to the state machine.
    if (!next && !busy) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deposit USDC</DialogTitle>
          <DialogDescription>
            Move testnet USDC from your wallet into your Over/Under balance. Polygon
            Amoy only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="depositAmount">Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted-foreground">
                $
              </span>
              <Input
                id="depositAmount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy}
                className="pl-6 tabular-nums"
              />
            </div>
            {walletBalanceUnits !== undefined && (
              <p className="text-xs text-muted-foreground">
                Wallet balance: ${displayUsdc(walletBalanceUnits)} USDC{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                  disabled={busy || walletBalanceUnits <= BigInt(0)}
                  // formatUsdc gives an exact 6-decimal literal, so "Max" is
                  // the real balance rather than a rounded display value.
                  onClick={() => setAmount(formatUsdc(walletBalanceUnits))}
                >
                  Max
                </button>
              </p>
            )}
          </div>

          {wrongChain && (
            <p className="rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
              Your wallet is on another network. Depositing will prompt you to switch to
              Polygon Amoy first.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleDeposit} disabled={busy || !amount} className="font-bold">
            {busy ? "Depositing…" : "Deposit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
