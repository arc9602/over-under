import { describe, expect, it } from "vitest";
import {
  getBetOptions,
  getOptionTotals,
  getPariMutuelPreview,
  getTotalPool,
  normalizeLegacyParticipants,
} from "../lib/utils/betPool";
import type { BetWithParticipants } from "../lib/types";

type Participant = BetWithParticipants["bet_participants"][number];

const profile = {
  id: "profile",
  username: "user",
  display_name: "User",
  avatar_url: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

function participant(
  userId: string,
  amount: number,
  optionId: string | null,
  side: "a" | "b" | null = null
): Participant {
  return {
    id: `participant-${userId}`,
    bet_id: "bet",
    user_id: userId,
    option_id: optionId,
    side,
    amount,
    joined_at: "2026-01-01T00:00:00.000Z",
    profiles: { ...profile, id: userId, username: userId },
  };
}

describe("getBetOptions", () => {
  it("builds legacy options when the expansion migration is disabled", () => {
    expect(
      getBetOptions({
        id: "bet",
        side_a_label: "Yes",
        side_b_label: "No",
        bet_options: [],
      })
    ).toEqual([
      { id: "a", bet_id: "bet", label: "Yes", sort_order: 0 },
      { id: "b", bet_id: "bet", label: "No", sort_order: 1 },
    ]);
  });

  it("sorts persisted options", () => {
    const options = getBetOptions({
      id: "bet",
      side_a_label: "Legacy A",
      side_b_label: "Legacy B",
      bet_options: [
        { id: "third", bet_id: "bet", label: "Third", sort_order: 2 },
        { id: "first", bet_id: "bet", label: "First", sort_order: 0 },
        { id: "second", bet_id: "bet", label: "Second", sort_order: 1 },
      ],
    });

    expect(options.map((option) => option.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

describe("pool calculations", () => {
  it("supports both migrated option ids and legacy sides", () => {
    const participants = [
      participant("legacy", 25, null, "a"),
      participant("new", 40, "option-a"),
    ];

    expect(getOptionTotals(participants, "a").total).toBe(25);
    expect(getOptionTotals(participants, "option-a").total).toBe(40);
    expect(getTotalPool(participants)).toBe(65);
  });

  it("uses legacy sides when the migration is present but flag is off", () => {
    const migrated = [
      participant("one", 25, "option-a-uuid", "a"),
      participant("two", 40, "option-b-uuid", "b"),
    ];
    const legacyView = normalizeLegacyParticipants(migrated);

    expect(getOptionTotals(legacyView, "a").total).toBe(25);
    expect(getOptionTotals(legacyView, "b").total).toBe(40);
  });

  it("calculates pari-mutuel payouts across three options", () => {
    const participants = [
      participant("winner-one", 60, "option-a"),
      participant("winner-two", 40, "option-a"),
      participant("loser-one", 30, "option-b"),
      participant("loser-two", 70, "option-c"),
    ];

    expect(
      getPariMutuelPreview(participants, "option-a", "winner-one")
    ).toEqual({
      isParticipant: true,
      wager: 60,
      payout: 120,
      profit: 60,
      refunded: false,
    });

    expect(
      getPariMutuelPreview(participants, "option-a", "loser-one")
    ).toEqual({
      isParticipant: true,
      wager: 30,
      payout: 0,
      profit: -30,
      refunded: false,
    });
  });

  it("refunds wagers when the winning option is unfunded", () => {
    const participants = [
      participant("one", 30, "option-a"),
      participant("two", 70, "option-b"),
    ];

    expect(
      getPariMutuelPreview(participants, "option-c", "one")
    ).toEqual({
      isParticipant: true,
      wager: 30,
      payout: 30,
      profit: 0,
      refunded: true,
    });
  });

  it("refunds wagers when there is no losing pool", () => {
    const participants = [
      participant("one", 30, "option-a"),
      participant("two", 70, "option-a"),
    ];

    expect(
      getPariMutuelPreview(participants, "option-a", "one")
    ).toEqual({
      isParticipant: true,
      wager: 30,
      payout: 30,
      profit: 0,
      refunded: true,
    });
  });
});
