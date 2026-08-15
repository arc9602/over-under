/**
 * Fails the build when a migration exists that supabase/APPLIED.md does not
 * record as run.
 *
 * CI deploys code; it does not apply SQL. Nothing else in the pipeline notices
 * when a commit ships a route that calls a function nobody created -- the build
 * is green, the upload succeeds, and the failure waits for a user to find it.
 * This is the thing that notices.
 *
 * It compares filenames only. It cannot tell whether the SQL actually ran, so
 * it catches "forgot entirely" and not "ran it badly". APPLIED.md says the same
 * about itself, at more length.
 *
 * No dependencies: this runs in CI before `npm ci` would matter and should not
 * need one.
 *
 *   node scripts/check-migrations.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");
const ledgerPath = join(root, "supabase", "APPLIED.md");

function fail(lines) {
  console.error("\nMigration check FAILED\n");
  for (const line of lines) console.error(line);
  console.error("");
  process.exit(1);
}

let ledgerText;
try {
  ledgerText = readFileSync(ledgerPath, "utf8");
} catch {
  fail([
    `Could not read ${ledgerPath}.`,
    "That file is the record of which migrations have been run against production.",
  ]);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

// Only list items under the "## Applied" heading count. Filenames appear in the
// prose above it as examples, and matching those would let the explanation
// satisfy the check it exists to describe.
const appliedSection = ledgerText.split(/^##\s+Applied\s*$/m)[1] ?? "";
const applied = new Set(
  appliedSection
    .split("\n")
    .map((l) => l.match(/^\s*-\s+(\S+\.sql)\s*$/)?.[1])
    .filter(Boolean)
);

const missing = files.filter((f) => !applied.has(f));
const stale = [...applied].filter((f) => !files.includes(f));

if (missing.length) {
  fail([
    `${missing.length} migration file(s) are not recorded as applied:`,
    ...missing.map((f) => `  - ${f}`),
    "",
    "If you have run these against production, add them to the '## Applied'",
    "list in supabase/APPLIED.md and commit that alongside the migration.",
    "",
    "If you have NOT run them, do that first. Deploying code that depends on a",
    "migration nobody applied puts a broken path live -- the build stays green",
    "and the failure waits for a user to hit it.",
  ]);
}

if (stale.length) {
  fail([
    `${stale.length} entr(y/ies) in supabase/APPLIED.md have no matching file:`,
    ...stale.map((f) => `  - ${f}`),
    "",
    "A migration was renamed or deleted after being applied. Renaming one that",
    "has already run does not un-run it, so fix the entry to match the file",
    "rather than deleting the line.",
  ]);
}

console.log(`Migration check OK: ${files.length} migration(s), all recorded as applied.`);
