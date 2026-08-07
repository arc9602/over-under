import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/008_bet_options.sql"),
  "utf8"
);

describe("multi-option expansion migration", () => {
  it("is transactional and preserves legacy columns", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).not.toMatch(/DROP COLUMN (side|side_a_label|side_b_label)/);
  });

  it("backfills options, participants, and resolutions", () => {
    expect(migration).toContain("WITH normalized AS");
    expect(migration).toContain("create_legacy_bet_options");
    expect(migration).toContain("UPDATE public.bet_participants bp");
    expect(migration).toContain("UPDATE public.resolutions r");
    expect(migration).toContain("map_legacy_participant_option");
    expect(migration).toContain("map_legacy_resolution_option");
  });

  it("enforces option ownership with composite foreign keys", () => {
    expect(migration).toContain("FOREIGN KEY (option_id, bet_id)");
    expect(migration).toContain(
      "FOREIGN KEY (proposed_winner_option_id, bet_id)"
    );
  });

  it("prevents direct resolution updates and concurrent proposals", () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Participants can update resolutions"'
    );
    expect(migration).toContain("resolutions_one_pending_per_bet_idx");
    expect(migration).toContain("FOR UPDATE;");
  });

  it("normalizes unconstrained historical labels", () => {
    expect(migration).toContain("left(btrim(side_a_label), 50)");
    expect(migration).toContain("Option 2 (legacy)");
  });

  it("uses authenticated identities for new mutation RPCs", () => {
    expect(migration.match(/UUID := auth\.uid\(\)/g)).toHaveLength(5);
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.place_option_wager"
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.place_option_wager"
    );
  });

  it("locks legacy security-definer RPCs to service_role", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.place_wager(UUID, UUID, TEXT, NUMERIC)"
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.confirm_resolution(UUID, UUID)"
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.dispute_resolution(UUID, UUID)"
    );
  });

  it("keeps the explicit no-IOU refund path", () => {
    expect(migration).toContain(
      "IF v_win_total = 0 OR v_lose_total = 0 THEN"
    );
    expect(migration).toContain(
      "No winner or no losing pool means every wager is refunded"
    );
  });
});
