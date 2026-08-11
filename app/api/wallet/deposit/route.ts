import "server-only";

import { decodeEventLog, type Address, type Hex } from "viem";

import {
  ApiError,
  apiError,
  apiOk,
  requireLinkedWallet,
  requireSession,
  serviceClient,
} from "@/lib/api/session";
import { isUniqueViolation, parseJsonBody, translateMoneyError } from "@/lib/api/request";
import { getPublicClient } from "@/lib/chain/client";
import { getMinDepositConfirmations, getUsdcAddress, getVaultAddress } from "@/lib/chain/env";
import { TRANSFER_TOPIC, usdcAbi } from "@/lib/chain/usdc";
import { formatUsdc, parseUsdc } from "@/lib/chain/amount";
import { depositSchema } from "@/lib/validation/wallet";

/**
 * POST /api/wallet/deposit -- credit a user's balance for USDC they have
 * already sent to the vault on-chain.
 *
 * The client tells us a transaction hash and an amount. Neither is trusted for
 * anything; both are claims to be checked against the chain. Everything this
 * route credits is spendable and withdrawable, so a hole here is a direct
 * drain of the vault rather than a bookkeeping annoyance.
 *
 * The division of labour with migration 014 is deliberate and should stay
 * that way: this route proves the money arrived, credit_usdc_deposit proves it
 * is recorded exactly once. There is no "have I seen this hash before?" SELECT
 * in here on purpose -- see step 7.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireSession();
    const { transactionHash, amount } = await parseJsonBody(request, depositSchema);

    // The address this user proved control of at /api/wallet/link. 400s if
    // they never linked one -- with no linked address there is no way to
    // attribute a deposit, and guessing is not an option.
    const linkedAddress = await requireLinkedWallet(user.id);

    const expectedUnits = parseUsdc(amount);
    const usdcAddress = getUsdcAddress();
    const vaultAddress = getVaultAddress();
    const minConfirmations = getMinDepositConfirmations();
    const publicClient = getPublicClient();

    // 1. The transaction must exist and be mined. viem throws rather than
    //    returning null for an unknown or still-pending hash.
    let receipt;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: transactionHash as Hex });
    } catch {
      throw new ApiError(404, "That transaction has not been mined yet");
    }

    // 2. It must have succeeded. A reverted transaction moved no tokens, but
    //    it still has a receipt and a hash that looks entirely legitimate in a
    //    block explorer URL.
    if (receipt.status !== "success") {
      throw new ApiError(400, "That transaction failed on-chain");
    }

    // 3. Enough confirmations. Crediting at zero means a deposit that gets
    //    reorged away has already become a real, withdrawable balance -- and
    //    by the time anyone notices, it has been withdrawn. Counted the way
    //    viem does: the including block itself is one confirmation.
    const latestBlock = await publicClient.getBlockNumber();
    const confirmations =
      latestBlock >= receipt.blockNumber ? latestBlock - receipt.blockNumber + 1n : 0n;
    if (confirmations < minConfirmations) {
      throw new ApiError(
        409,
        `Waiting for confirmations (${confirmations}/${minConfirmations}) -- try again shortly`
      );
    }

    // 4. Find the Transfer that actually pays the vault.
    //
    //    log.address is checked FIRST and it is the check people skip. A
    //    transaction carries logs from every contract it touched, and emitting
    //    a Transfer event from a worthless token you deployed yourself costs a
    //    few cents. Without pinning the emitter to the configured USDC
    //    contract, "prove you sent USDC" degrades to "prove you sent
    //    something", and the something can be free.
    const transfers = receipt.logs
      .filter(
        (log) =>
          log.address.toLowerCase() === usdcAddress && log.topics[0] === TRANSFER_TOPIC
      )
      .map((log) => {
        try {
          const decoded = decodeEventLog({
            abi: usdcAbi,
            eventName: "Transfer",
            data: log.data,
            topics: log.topics,
          });
          return decoded.args;
        } catch {
          // Right topic0, wrong shape -- not a standard Transfer. Ignore it
          // rather than letting one malformed log abort the whole check.
          return null;
        }
      })
      .filter((args): args is { from: Address; to: Address; value: bigint } => args !== null);

    if (transfers.length === 0) {
      throw new ApiError(400, "That transaction contains no USDC transfer");
    }

    const toVault = transfers.filter((t) => t.to.toLowerCase() === vaultAddress);
    if (toVault.length === 0) {
      throw new ApiError(400, "That transfer was not sent to the deposit address");
    }

    // 5. The sender must be the caller's own linked wallet.
    //
    //    This is the check the whole endpoint turns on. A receipt proves SOME
    //    address sent USDC to the vault; it says nothing about who is asking.
    //    Without this, anyone can watch the vault address on a block explorer,
    //    grab a fresh deposit hash, and POST it here before the real depositor
    //    does -- the hash is public the moment it hits the mempool, and
    //    whoever calls first wins the money.
    const fromCaller = toVault.filter((t) => t.from.toLowerCase() === linkedAddress);
    if (fromCaller.length === 0) {
      throw new ApiError(400, "That deposit did not come from your linked wallet");
    }

    // 6. Exact amount. Not >=, not "close enough": the credited number has to
    //    be the number that moved, and comparing bigint base units means no
    //    rounding can creep in between the chain and the ledger.
    const matching = fromCaller.find((t) => t.value === expectedUnits);
    if (!matching) {
      throw new ApiError(400, "The amount does not match the on-chain transfer");
    }

    // 7. Credit it. Replay protection is UNIQUE (transaction_hash) INSIDE
    //    credit_usdc_deposit, not a check out here: two concurrent POSTs with
    //    the same hash would both pass a "not processed yet" SELECT and both
    //    credit. In the function, the second INSERT raises a unique violation
    //    in the same transaction that does the crediting, so the credit rolls
    //    back with it. Concurrency is Postgres's problem, and it solves it
    //    correctly.
    const db = await serviceClient();
    const { data: depositId, error } = await db.rpc("credit_usdc_deposit", {
      p_user_id: user.id,
      p_transaction_hash: transactionHash,
      p_from_address: linkedAddress,
      // Normalized to a NUMERIC(20,6) literal via bigint base units, so what
      // is stored is exactly what the chain moved.
      p_amount: formatUsdc(matching.value),
      // Block numbers are far below Number.MAX_SAFE_INTEGER; this is the one
      // place a bigint -> number conversion is safe, and it is not money.
      p_block_number: Number(receipt.blockNumber),
    });

    if (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "That deposit has already been credited");
      }
      const translated = translateMoneyError(error);
      if (translated) throw translated;
      // Anything else reaches apiError as an unknown and becomes a flat 500.
      // Raw Postgres text names tables and constraints; it does not go out.
      throw error;
    }

    return apiOk(
      {
        depositId,
        amount: formatUsdc(matching.value),
        transactionHash,
        blockNumber: receipt.blockNumber.toString(),
      },
      201
    );
  } catch (error) {
    return apiError(error);
  }
}
