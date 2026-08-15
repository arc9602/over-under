"use client";

import { useState } from "react";
import { SideChoice, type SideChoiceOption } from "@/components/bet/SideChoice";

// Illustrative only -- nobody has actually staked anything here. Numbers are
// picked to look like a real, slightly lopsided group bet, not a round demo
// value like 50/50 or $100.
const HERO_OPTIONS: SideChoiceOption[] = [
  { id: "late", label: "He's late again", total: 65, count: 5, names: ["Priya", "Alex", "Chris", "Morgan", "Riley"] },
  { id: "on-time", label: "He's on time", total: 40, count: 3, names: ["Sam", "Taylor", "Devon"] },
];

/**
 * The hero's entire pitch is "try it before you sign up" -- this is the real
 * SideChoice component wired to local state instead of a server action, so a
 * visitor with no account can pick a side on the landing page itself and see
 * the same response a real invite link gives them.
 */
export function HeroSideChoice() {
  const [value, setValue] = useState<string | null>(null);

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl shadow-black/40 sm:p-6">
      <SideChoice
        options={HERO_OPTIONS}
        value={value}
        onChange={setValue}
        groupLabel="He's late again, or he's on time"
      />
    </div>
  );
}
