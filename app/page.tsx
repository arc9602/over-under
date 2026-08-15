import { redirect } from "next/navigation";
import Link from "next/link";
import { Dices, Link2, CircleCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { BetStatusBadge } from "@/components/bet/BetStatusBadge";
import { SplitBar } from "@/components/shared/SplitBar";
import { HeroSideChoice } from "@/components/landing/HeroSideChoice";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    Icon: Dices,
    verb: "Make the call",
    detail:
      "Set the terms: what's being bet, who's in, and the deadline it has to be settled by.",
  },
  {
    Icon: Link2,
    verb: "Send the link",
    detail:
      "Drop the invite in the group chat. Anyone can open it and see the bet before they sign up.",
  },
  {
    Icon: CircleCheck,
    verb: "Settle up",
    detail:
      "Once the outcome's confirmed, Over/Under records who owes what. You settle between yourselves.",
  },
];

// Two snapshots of the same illustrative market, not two different markets --
// same $150 -> $450 pool, shown before and after more people piled onto
// "Goes to overtime." The point is the shrinking multiplier, not the totals.
const POOL_SNAPSHOTS = [
  { timeLabel: "Tuesday", overTotal: 90, underTotal: 60 },
  { timeLabel: "Kickoff", overTotal: 310, underTotal: 140 },
];

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  return (
    <div className="flex flex-col">
      {/* 1. Hero -- asymmetric split. Copy on the left, a real, tappable
          SideChoice on the right so a visitor with no account can feel the
          product respond before they ever sign up. */}
      <section className="px-4 pt-20 sm:px-6 md:pt-24 lg:px-8">
        <div className="mx-auto grid min-h-[calc(100dvh-5rem)] max-w-7xl grid-cols-1 items-center gap-12 md:min-h-[calc(100dvh-6rem)] lg:grid-cols-2 lg:gap-16">
          <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700 motion-safe:ease-[var(--ease-out)]">
            <h1 className="text-5xl font-black leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
              Bet on it.
              <br />
              Settle it.
            </h1>
            <p className="mt-5 max-w-md text-lg text-muted-foreground">
              Turn the argument in your group chat into a bet you can actually settle.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className={cn(buttonVariants({ size: "lg" }), "h-auto px-8 py-4 text-base font-black")}
              >
                Start a bet
              </Link>
              <a
                href="#how-it-works"
                className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-auto px-6 py-4 text-base font-bold")}
              >
                How it works
              </a>
            </div>
          </div>

          <div className="flex justify-center motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-8 motion-safe:delay-150 motion-safe:duration-700 motion-safe:ease-[var(--ease-out)] lg:justify-end">
            <HeroSideChoice />
          </div>
        </div>
      </section>

      {/* 2. How it works -- a vertical stepped rhythm, not three equal cards.
          The verb is the label; no "Step 1" scaffolding. */}
      <section id="how-it-works" className="px-4 py-24 sm:px-6 md:py-32 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="max-w-lg text-3xl font-black tracking-tight md:text-4xl">
            From an argument to a settled bet in three steps.
          </h2>

          <div className="mt-14 max-w-3xl space-y-14 md:mt-20 md:space-y-20">
            {STEPS.map(({ Icon, verb, detail }, i) => (
              <div
                key={verb}
                className={cn(
                  "flex items-start gap-6 md:gap-10 motion-safe:[animation-range:entry_0%_entry_60%] motion-safe:[animation-timeline:view()] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-6 motion-safe:fill-mode-both motion-safe:duration-500 motion-safe:ease-[var(--ease-out)]",
                  i % 2 === 1 && "md:ml-16"
                )}
              >
                <div className="flex shrink-0 flex-col items-start gap-3">
                  <span className="font-mono text-sm text-primary/70">0{i + 1}</span>
                  <Icon className="size-6 text-primary" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-2xl font-black md:text-3xl">{verb}</h3>
                  <p className="mt-2 max-w-md text-muted-foreground">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. The odds move -- the mechanism, shown with the real SplitBar
          rather than claimed in a sentence. Near-full-bleed band, distinct
          from the plain background of the two sections above it. */}
      <section className="border-y border-border bg-card/40 px-4 py-24 sm:px-6 md:py-32 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="max-w-lg text-3xl font-black tracking-tight md:text-4xl">
            The odds move as people join.
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            Over/Under doesn&apos;t set fixed odds. Winners split the losing pool in proportion to
            their stake, so any projected return is an estimate, and it moves right up until the
            deadline.
          </p>

          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {POOL_SNAPSHOTS.map((snap, i) => {
              const total = snap.overTotal + snap.underTotal;
              const multiplier = (total / snap.overTotal).toFixed(2);
              return (
                <div
                  key={snap.timeLabel}
                  className="rounded-2xl border border-border bg-card p-6 motion-safe:[animation-range:entry_0%_entry_60%] motion-safe:[animation-timeline:view()] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:duration-500 motion-safe:ease-[var(--ease-out)]"
                  style={i === 1 ? { animationDelay: "75ms" } : undefined}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-muted-foreground">{snap.timeLabel}</p>
                    <BetStatusBadge status="active" />
                  </div>

                  <SplitBar leftValue={snap.overTotal} rightValue={snap.underTotal} className="mt-4" />

                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="font-mono">{formatCurrency(snap.overTotal)} on Goes to overtime</span>
                    <span className="font-mono">{formatCurrency(snap.underTotal)} on Ends in regulation</span>
                  </div>

                  <p className="mt-4 text-sm">
                    Estimated return on <span className="font-bold text-foreground">Goes to overtime</span>:{" "}
                    <span className="font-mono font-bold text-primary">{multiplier}x</span>
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Illustrative pool. Estimate only, it moves as more people join.
          </p>
        </div>
      </section>

      {/* 4. Nobody holds your money -- quiet and typographic, no cards, the
          opposite layout family from the section above it. */}
      <section className="px-4 py-24 sm:px-6 md:py-32 lg:px-8">
        <div className="mx-auto max-w-3xl motion-safe:[animation-range:entry_0%_entry_60%] motion-safe:[animation-timeline:view()] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:duration-500 motion-safe:ease-[var(--ease-out)]">
          <p className="text-3xl font-black leading-snug tracking-tight md:text-4xl">
            Over/Under does not hold your money.
          </p>
          <p className="mt-6 text-xl leading-relaxed text-muted-foreground">
            It records what was agreed and who owes whom.
          </p>
          <p className="mt-2 text-xl leading-relaxed text-muted-foreground">
            People settle between themselves.
          </p>
        </div>
      </section>

      {/* 5. Close -- same CTA label as the hero, minimal footer. */}
      <section className="border-t border-border px-4 py-24 sm:px-6 md:py-32 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-black tracking-tight md:text-4xl">
            Ready to make it official?
          </h2>
          <Link
            href="/login"
            className={cn(buttonVariants({ size: "lg" }), "mt-8 h-auto px-8 py-4 text-base font-black")}
          >
            Start a bet
          </Link>
        </div>
      </section>

      <footer className="border-t border-border px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <span className="font-black tracking-tight text-foreground">OVER/UNDER</span>
          <span>© 2026 Over/Under</span>
        </div>
      </footer>
    </div>
  );
}
