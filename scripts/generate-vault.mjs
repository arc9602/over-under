/**
 * Generates the platform vault keypair and writes it into .env.local.
 *
 *   node scripts/generate-vault.mjs
 *
 * Prints ONLY the public address. The private key goes straight from memory
 * into the file and is never written to stdout, so it cannot end up in a
 * terminal scrollback, a CI log, or a chat transcript -- the three places a
 * key most commonly leaks from.
 *
 * The pair it writes is matched by construction: NEXT_PUBLIC_VAULT_ADDRESS is
 * derived from VAULT_PRIVATE_KEY rather than typed alongside it. That matters
 * because a mismatched pair is invisible until the first withdrawal, at which
 * point every deposit users have made is sitting at an address the signer
 * cannot spend from.
 *
 * Testnet only. In production the vault key belongs in
 * `wrangler secret put VAULT_PRIVATE_KEY`, never in a file.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = process.argv[2] ?? ".env.local";

if (!existsSync(envPath)) {
  console.error(`${envPath} does not exist. Copy .env.example to .env.local first:`);
  console.error(`  cp .env.example .env.local`);
  process.exit(1);
}

let env = readFileSync(envPath, "utf8");

// Refuse to clobber a vault that is already configured. Overwriting a live key
// orphans every deposit sitting at the old address -- the old key would be
// gone, and with it any way to recover those funds.
const existing = /^VAULT_PRIVATE_KEY=(.*)$/m.exec(env)?.[1]?.trim() ?? "";
if (existing && !existing.startsWith("PASTE_")) {
  console.error("REFUSED: VAULT_PRIVATE_KEY is already set in " + envPath + ".");
  console.error("Clear that line by hand first if you really mean to replace the vault.");
  process.exit(1);
}

function setVar(source, name, value) {
  const re = new RegExp(`^${name}=.*$`, "m");
  if (!re.test(source)) {
    throw new Error(`${name} not found in ${envPath} -- refusing to guess where it goes`);
  }
  return source.replace(re, `${name}=${value}`);
}

const privateKey = generatePrivateKey();
const address = privateKeyToAccount(privateKey).address.toLowerCase();

env = setVar(env, "VAULT_PRIVATE_KEY", privateKey);
env = setVar(env, "NEXT_PUBLIC_VAULT_ADDRESS", address);
writeFileSync(envPath, env);

console.log(`Vault written to ${envPath}`);
console.log(`Public address: ${address}`);
console.log("");
console.log("Next: fund this address with Amoy POL for gas at faucet.polygon.technology");
console.log("(withdrawals are sent by the vault, so with no POL they fail at broadcast)");
