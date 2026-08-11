import "server-only";

import type { Address, Hex } from "viem";

import { ApiError, apiError, apiOk, requireSession, serviceClient } from "@/lib/api/session";
import { parseJsonBody, translateMoneyError } from "@/lib/api/request";
import { getPublicClient, getVaultWalletClient, polygonAmoy } from "@/lib/chain/client";
import { getUsdcAddress } from "@/lib/chain/env";
import { usdcAbi } from "@/lib/chain/usdc";
import { formatUsdc, parseUsdc } from "@/lib/chain/amount";
import { withdrawSchema } from "@/lib/validation/wallet";

/**
 * POST /api/wallet/withdraw -- pay a user's available balance out to their
 * linked wallet.
 *
 * The ordering below is the entire design, and it is the one part of this
 * feature where "obviously equivalent" rearrangements are not equivalent:
 *
 *   1. Reserve the funds in the database FIRST (available ->
 *      withdrawal_pending, atomically, under a row lock). Sending first and
 *      debiting after means a user can spend or re-withdraw the same balance
 *      in the window between the two, and the second request has no way to
 *      know about the first.
 *   2. Send on-chain, to the address SNAPSHOTTED in step 1.
 *   3. Record the hash.
 *   4. Wait for the receipt, then finalize (money leaves the system) or revert
 *      (money returns to available).
 *
 * Steps 1, 3 and 4 are single atomic RPCs; nothing about this file's control
 * flow is load-bearing for their correctness. Step 2 is the part that cannot
 * join a database transaction, which is why the three-phase withdrawal exists
 * at all.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireSession();
    const { amount } = await parseJsonBody(request, withdrawSchema);

    const units = parseUsdc(amount);
    const normalizedAmount = formatUsdc(units);
    const db = await serviceClient();

    // ------------------------------------------------------------
    // 1. Reserve. Nothing has been sent; a failure here is clean.
    // ------------------------------------------------------------
    // This RPC also enforces the things this route deliberately does NOT
    // re-implement: a wallet must be linked, the available balance must cover
    // the amount (checked under the account row lock, so it cannot race), and
    // only one withdrawal may be in flight per user.
    //
    // Note the destination is NOT taken from the request body and NOT read
    // from wallet_links out here -- begin_usdc_withdrawal snapshots it into
    // the row, so a re-link that lands mid-flight cannot redirect a payout
    // that was already authorized against the old address.
    const { data: withdrawal, error: beginError } = await db.rpc("begin_usdc_withdrawal", {
      p_user_id: user.id,
      p_amount: normalizedAmount,
    });

    if (beginError) {
      const translated = translateMoneyError(beginError);
      if (translated) throw translated;
      throw beginError;
    }
    if (!withdrawal) {
      throw new ApiError(500, "Could not start the withdrawal");
    }

    const withdrawalId = withdrawal.id;
    const toAddress = withdrawal.to_address as Address;
    const usdcAddress = getUsdcAddress();
    const publicClient = getPublicClient();

    /** Money back to available. Only ever called when nothing is on-chain. */
    const revert = async (reason: string) => {
      const { error } = await db.rpc("revert_usdc_withdrawal", {
        p_withdrawal_id: withdrawalId,
        p_reason: reason,
      });
      if (error) {
        // The user's funds are sitting in withdrawal_pending and this is the
        // only automatic way out of it, so a failure here needs a human.
        console.error("[wallet/withdraw] revert failed", { withdrawalId, error });
      }
    };

    // ------------------------------------------------------------
    // 2a. Prepare. Provably nothing has been broadcast after this block.
    // ------------------------------------------------------------
    // Split out from the send on purpose. Everything in here is either local
    // (building the signer, which also asserts VAULT_PRIVATE_KEY controls the
    // configured vault address) or a read-only eth_call. Neither can put a
    // transaction on the network, so a throw is unambiguous and reverting is
    // always the right answer.
    //
    // Simulating first also converts the common real failures -- RPC
    // unreachable, vault under-funded, wrong token address -- from ambiguous
    // send failures into clean, refundable ones.
    let walletClient: ReturnType<typeof getVaultWalletClient>;
    try {
      walletClient = getVaultWalletClient();
      await publicClient.simulateContract({
        account: walletClient.account,
        address: usdcAddress,
        abi: usdcAbi,
        functionName: "transfer",
        args: [toAddress, units],
      });
    } catch (error) {
      // Never include the error text in the response: a viem/config error can
      // quote environment values. VAULT_PRIVATE_KEY specifically is never in
      // any of these messages by construction (see lib/chain/env.ts), and it
      // must stay that way.
      console.error("[wallet/withdraw] pre-flight failed", { withdrawalId });
      await revert("Vault transfer could not be prepared");
      throw new ApiError(
        502,
        "Withdrawals are temporarily unavailable. Your balance has not changed."
      );
    }

    // ------------------------------------------------------------
    // 2b. Broadcast. The ambiguous window.
    // ------------------------------------------------------------
    // A throw here means the signed transaction may or may not have reached
    // the network: viem signs locally and then calls eth_sendRawTransaction,
    // and a timeout, a dropped connection, or a proxy 502 on that call is
    // indistinguishable from the node having accepted it. It can even have
    // been accepted and mined while the error was on its way back.
    //
    // So this path deliberately does NOT revert. Reverting would return the
    // money to available while the transfer is still live on-chain, and the
    // user could then withdraw the same balance a second time -- paying twice
    // out of a vault that is only solvent for one. The withdrawal is left
    // 'pending' with no hash for manual reconciliation: check the vault
    // address on the explorer, then finalize_usdc_withdrawal (it went out) or
    // revert_usdc_withdrawal (it did not). Leaving a user's funds frozen is
    // the recoverable failure; double-paying is not.
    let hash: Hex;
    try {
      hash = await walletClient.writeContract({
        account: walletClient.account,
        chain: polygonAmoy,
        address: usdcAddress,
        abi: usdcAbi,
        functionName: "transfer",
        args: [toAddress, units],
      });
    } catch (error) {
      console.error("[wallet/withdraw] BROADCAST AMBIGUOUS -- manual reconciliation required", {
        withdrawalId,
        userId: user.id,
        amount: normalizedAmount,
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new ApiError(
        500,
        "Your withdrawal is being reviewed. Please contact support before trying again."
      );
    }

    // ------------------------------------------------------------
    // 3. Record the hash.
    // ------------------------------------------------------------
    // Not fatal if it fails, and definitely not a reason to revert: the
    // transfer is already on-chain. finalize_usdc_withdrawal accepts a row in
    // either 'pending' or 'sent', so the flow below still completes; the row
    // just loses its hash for auditing.
    const { error: sentError } = await db.rpc("mark_usdc_withdrawal_sent", {
      p_withdrawal_id: withdrawalId,
      p_transaction_hash: hash,
    });
    if (sentError) {
      console.error("[wallet/withdraw] could not record tx hash", { withdrawalId, hash });
    }

    // ------------------------------------------------------------
    // 4. Settle against the receipt.
    // ------------------------------------------------------------
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    } catch {
      // Timed out waiting. The transaction is broadcast and may confirm at any
      // moment, so this is the same ambiguity as 2b and gets the same
      // treatment: no revert. The row stays 'sent' with its hash, which is
      // exactly what a reconciliation job needs.
      console.warn("[wallet/withdraw] receipt not seen in time; left as sent", {
        withdrawalId,
        hash,
      });
      return apiOk(
        { withdrawalId, status: "sent", transactionHash: hash, amount: normalizedAmount },
        202
      );
    }

    if (receipt.status === "success") {
      const { error: finalizeError } = await db.rpc("finalize_usdc_withdrawal", {
        p_withdrawal_id: withdrawalId,
      });
      if (finalizeError) {
        // Money is out on-chain but withdrawal_pending was not cleared. Do not
        // revert -- that would credit the user for funds they already have.
        console.error("[wallet/withdraw] finalize failed after confirmed send", {
          withdrawalId,
          hash,
        });
        throw new ApiError(500, "Your withdrawal was sent but is still being confirmed");
      }
      return apiOk({
        withdrawalId,
        status: "confirmed",
        transactionHash: hash,
        amount: normalizedAmount,
      });
    }

    // Mined and reverted. The token never moved -- an on-chain revert undoes
    // all state changes -- so returning the funds is correct and safe.
    await revert(`On-chain transfer reverted (${hash})`);
    throw new ApiError(502, "The transfer failed on-chain. Your balance has been restored.");
  } catch (error) {
    return apiError(error);
  }
}
