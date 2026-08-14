import "server-only";

import { verifyMessage } from "viem";

import {
  ApiError,
  apiError,
  apiOk,
  enforceRateLimit,
  requireSameOrigin,
  requireSession,
  serviceClient,
} from "@/lib/api/session";
import { isUniqueViolation, parseJsonBody } from "@/lib/api/request";
import {
  WALLET_LINK_MAX_AGE_MS,
  WALLET_LINK_MAX_SKEW_MS,
  linkWalletSchema,
  parseWalletLinkMessage,
} from "@/lib/validation/wallet";

/**
 * POST /api/wallet/link -- bind a verified on-chain address to the signed-in
 * account.
 *
 * The signature is the entire security of this endpoint. `wallet_links` is
 * read by exactly two paths that matter, and both of them treat it as proof:
 *
 *   /api/wallet/withdraw pays the vault's USDC out to the linked address.
 *   /api/wallet/deposit  credits a deposit only if the Transfer log's `from`
 *                        equals the linked address.
 *
 * So accepting an address without proving control of its key is not a missing
 * nicety -- it lets any signed-in user point their withdrawals at someone
 * else's wallet, or claim someone else's deposits by pre-linking the address
 * they are about to deposit from.
 *
 * Nothing in this file reads process.env at module scope; see lib/chain/env.ts
 * for why that rule exists.
 */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { user } = await requireSession();
    await enforceRateLimit(user.id, "wallet_link", 10, 60);
    const { address, signature, message, walletType } = await parseJsonBody(
      request,
      linkWalletSchema
    );

    // 1. The message must be one WE defined, for THIS user, for THIS address,
    //    issued recently. See lib/validation/wallet.ts for what each field
    //    stops. A bare "sign this random string" flow would verify fine here
    //    and still be replayable.
    const parsed = parseWalletLinkMessage(message);
    if (!parsed) {
      throw new ApiError(400, "That message is not a wallet link request");
    }
    if (parsed.address !== address) {
      throw new ApiError(400, "The signed message is for a different wallet");
    }
    if (parsed.userId !== user.id) {
      throw new ApiError(400, "The signed message is for a different account");
    }

    const age = Date.now() - parsed.issuedAt.getTime();
    if (age > WALLET_LINK_MAX_AGE_MS) {
      throw new ApiError(400, "That signature has expired -- please sign again");
    }
    if (age < -WALLET_LINK_MAX_SKEW_MS) {
      throw new ApiError(400, "That signature is dated in the future -- check your clock");
    }

    // 2. The cryptography. verifyMessage recovers the signer from the EIP-191
    //    personal_sign hash of the exact message bytes and compares it to the
    //    claimed address; a mismatch, a truncated signature, or a signature
    //    over any other string all come back false.
    let verified = false;
    try {
      verified = await verifyMessage({ address, message, signature });
    } catch {
      // Malformed-but-well-shaped signatures make viem throw rather than
      // return false. Same outcome from the caller's point of view.
      verified = false;
    }
    if (!verified) {
      throw new ApiError(400, "That signature does not match this wallet");
    }

    // 3. Record it. Service client because wallet_links has no INSERT policy
    //    at all -- every write in 014 goes through the service role, and RLS
    //    is read-only by design.
    const db = await serviceClient();
    const { error } = await db.from("wallet_links").upsert(
      {
        user_id: user.id,
        // Already lowercased by evmAddressSchema, which is what the
        // ^0x[0-9a-f]{40}$ CHECK on this column requires.
        address,
        wallet_type: walletType ?? null,
        verified_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) {
      // UNIQUE (address) with a different user_id: this wallet already belongs
      // to another account. Deliberate in 014 -- two accounts sharing a wallet
      // makes deposit attribution ambiguous the moment both claim one hash.
      // The onConflict above covers the caller re-linking their OWN row, so a
      // unique violation reaching here is always the cross-account case.
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "That wallet is already linked to another account");
      }
      throw error;
    }

    return apiOk({ address, walletType: walletType ?? null });
  } catch (error) {
    return apiError(error);
  }
}
