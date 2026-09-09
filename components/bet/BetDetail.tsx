import { Card, CardContent } from "@/components/ui/card";
import { SplitBar } from "@/components/shared/SplitBar";
import { BetStatusBadge } from "./BetStatusBadge";
import { CountdownTimer } from "./CountdownTimer";
import { BetPoolChart } from "./BetPoolChart";
import { BetWagerChart } from "./BetWagerChart";
import { cn } from "@/lib/utils";
import { formatStake } from "@/lib/utils/formatStake";
import { formatDate } from "@/lib/utils/formatDate";
import {
  getSideTotals,
  getPariMutuelPreview,
  getOptionPariMutuelPreview,
  getPoolHistory,
  getUserPoolHistory,
  getBetOptions,
  getOptionTotals,
} from "@/lib/utils/betPool";
import { getBetOutcome, getConfirmedResolution, type BetOutcome } from "@/lib/utils/betOutcome";
import { TERMINAL_STATUSES, type BetWithDetails } from "@/lib/types";

interface BetDetailProps {
  bet: BetWithDetails;
  currentUserId: string;
}

type PariMutuelPreview = ReturnType<typeof getPariMutuelPreview>;
type Participant = BetWithDetails["bet_participants"][number];

function SideList({
  label,
  rows,
  total,
  currentUserId,
  highlighted,
  stake,
}: {
  label: string;
  rows: BetWithDetails["bet_participants"];
  total: number;
  currentUserId: string;
  highlighted: boolean;
  /** Formats an amount in the bet's own stake unit (migration 022). */
  stake: (amount: number) => string;
}) {
  return (
    <Card className={highlighted ? "border-primary/50 bg-primary/5" : ""}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-bold text-sm truncate min-w-0">{label}</p>
          <p className="text-sm font-semibold text-primary tabular-nums shrink-0">
            {stake(total)}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Waiting for wagers…</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground truncate min-w-0">
                  {p.profiles?.display_name ?? p.profiles?.username}
                  {p.user_id === currentUserId && <span className="text-primary ml-1">(you)</span>}
                </span>
                <span className="font-medium tabular-nums shrink-0">
                  {stake(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Question 2: where do I stand. A live pari-mutuel projection while the bet
// is still open to a winner being decided; the CONFIRMED outcome once it
// isn't. Never the reverse -- showing a "potential win" on a settled bet
// regardless of what actually happened is the exact bug fixed in c2b7896.
function MyPosition({
  mine,
  mySideLabel,
  preview,
  outcome,
  isTwoOption,
  totalPool,
  stake,
}: {
  mine: Participant | undefined;
  mySideLabel: string | null;
  preview: PariMutuelPreview | null;
  outcome: BetOutcome;
  isTwoOption: boolean;
  totalPool: number;
  /** Formats an amount in the bet's own stake unit (migration 022). */
  stake: (amount: number) => string;
}) {
  if (!mine) {
    return (
      <p className="text-sm text-muted-foreground tabular-nums">
        {totalPool > 0
          ? `${stake(totalPool)} wagered so far. You haven't taken a side.`
          : "Nobody has wagered yet."}
      </p>
    );
  }

  if (preview && preview.isParticipant) {
    const colorClass = isTwoOption ? (mine.side === "a" ? "text-win" : "text-loss") : "text-primary";
    return (
      <div className="space-y-1.5">
        <p className="text-sm text-muted-foreground">
          You&apos;re on <span className="font-medium text-foreground">{mySideLabel}</span>
        </p>
        <div className="flex items-baseline gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Stake</p>
            <p className="text-xl font-semibold tabular-nums">{stake(preview.wager)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">If you&apos;re right</p>
            {/* Net gain, matching the card and the settled outcome. The gross
                payout returns the stake as well, which is money the user
                already had rather than something the bet won them. */}
            <p className={cn("text-xl font-semibold tabular-nums", colorClass)}>
              +{stake(preview.profit)}
            </p>
          </div>
        </div>
        {/* Payouts are pari-mutuel -- winners split the losing pool, so this
            number moves every time someone else wagers. It's an estimate
            against the pool as it stands right now, never a promise. */}
        <p className="text-xs text-muted-foreground">
          Estimate, not a promise — moves as more people wager.
        </p>
      </div>
    );
  }

  if (outcome.kind !== "none") {
    return (
      <div className="space-y-1.5">
        <p className="text-sm text-muted-foreground">
          You were on <span className="font-medium text-foreground">{mySideLabel}</span>
        </p>
        <div className="flex items-baseline gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Stake</p>
            <p className="text-lg font-semibold text-muted-foreground tabular-nums">
              {stake(mine.amount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{outcome.kind === "won" ? "Won" : "Lost"}</p>
            {/* Net, stake excluded, signed -- matching BetWagerChart's line and
                BetCard's figure so all three describe the same result. */}
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                outcome.kind === "won" ? "text-win" : "text-loss"
              )}
            >
              {outcome.net >= 0 ? "+" : "−"}
              {stake(Math.abs(outcome.net))}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Terminal with no confirmed outcome to report: resolved-but-unconfirmed,
  // cancelled, expired, or stuck. Deliberately neutral, same reasoning as
  // BetCard -- cancelBet (lib/actions/bets.ts) only flips bets.status, it
  // never touches bet_participants or any ledger row, so there's nothing
  // honest to call "returned" here.
  return (
    <div>
      <p className="text-sm text-muted-foreground">
        You were on <span className="font-medium text-foreground">{mySideLabel}</span>
      </p>
      <p className="text-lg font-semibold text-muted-foreground tabular-nums mt-0.5">
        {stake(mine.amount)} staked
      </p>
    </div>
  );
}

// Question 3: what happens next. The actions themselves (wager form, lock,
// resolve, cancel) live below this component in the page -- this is just
// the state that explains why those are, or aren't, on screen.
function NextUp({
  bet,
  isResolving,
  canStillWager,
}: {
  bet: BetWithDetails;
  isResolving: boolean;
  canStillWager: boolean;
}) {
  let content: React.ReactNode = null;

  if (canStillWager && bet.deadline) {
    content = (
      <>
        <span className="text-sm text-muted-foreground">Betting closes</span>
        <CountdownTimer deadline={bet.deadline} />
      </>
    );
  } else if (canStillWager) {
    content = <span className="text-sm text-muted-foreground">Open — no deadline set.</span>;
  } else if (bet.status === "locked") {
    content = (
      <span className="text-sm text-muted-foreground">
        Deadline passed. Anyone who wagered can propose a winner below.
      </span>
    );
  } else if (bet.status === "resolving") {
    content = (
      <span className="text-sm text-resolving">
        A winner has been proposed — it needs another participant to confirm below.
      </span>
    );
  } else if (bet.status === "resolved") {
    content = (
      <span className="text-sm text-muted-foreground">
        {bet.resolved_at ? `Settled ${formatDate(bet.resolved_at)}.` : "Settled."}
      </span>
    );
  } else if (bet.status === "cancelled") {
    content = <span className="text-sm text-muted-foreground">Cancelled. No wagers were settled.</span>;
  } else if (bet.status === "expired") {
    content = <span className="text-sm text-muted-foreground">Expired without a resolution.</span>;
  } else if (bet.status === "stuck") {
    content = (
      <span className="text-sm text-destructive">
        Stuck after repeated disputes — needs manual resolution below.
      </span>
    );
  }

  if (!content) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        // Same signal BetRow uses for a resolving row -- a background tint,
        // not color alone, so it survives for a colorblind reader.
        isResolving && "rounded-md bg-resolving/10 px-3 py-2"
      )}
    >
      {content}
    </div>
  );
}

export function BetDetail({ bet, currentUserId }: BetDetailProps) {
  // Bets can be staked in something other than money (migration 022); every
  // amount on this screen is denominated in the bet's own unit.
  const stake = (amount: number) =>
    formatStake(amount, bet.stake_unit, bet.stake_unit_plural);

  const options = getBetOptions(bet);
  const isTwoOption = options.length === 2;
  const totalPool = bet.bet_participants.reduce((sum, p) => sum + p.amount, 0);

  const isTerminal = TERMINAL_STATUSES.includes(bet.status);
  const isResolving = bet.status === "resolving";

  // While the bet still takes wagers, WagerForm/OptionWagerForm is on screen
  // below and this is a "deciding" view -- the pool trend is always shown,
  // but the user's own wager chart stays hidden (the form's live
  // predicted-payout preview already covers that). Once wagering closes,
  // it's a "checking on it" view, so both charts show.
  const canStillWager = bet.status === "open" || bet.status === "active";

  // The 2-option chart pair (BetPoolChart/BetWagerChart) plots a single
  // 0-100 probability line and has no N-way equivalent yet -- see
  // components/bet/BetPoolChart.tsx. 3+-option bets get the same option
  // cards everyone else gets, just without those two charts.
  const sideA = isTwoOption ? getSideTotals(bet.bet_participants, "a") : null;
  const sideB = isTwoOption ? getSideTotals(bet.bet_participants, "b") : null;
  const poolHistory = isTwoOption ? getPoolHistory(bet.bet_participants) : null;
  // Only a confirmed resolution names a real winner -- pending/disputed/
  // superseded rows decide nothing (see getConfirmedResolution). Passing
  // this through makes getUserPoolHistory chart the actual outcome once
  // there is one, instead of always projecting the viewer's own side to win.
  const confirmedWinnerSide = getConfirmedResolution(bet.resolutions)?.proposed_winner_side ?? null;
  const userPoolHistory = isTwoOption
    ? getUserPoolHistory(bet.bet_participants, currentUserId, confirmedWinnerSide)
    : null;

  const mine = bet.bet_participants.find((p) => p.user_id === currentUserId);
  const mySideLabel = !mine
    ? null
    : isTwoOption
    ? mine.side === "a"
      ? bet.side_a_label
      : bet.side_b_label
    : options.find((o) => o.id === mine.option_id)?.label ?? null;

  // Same "if my side wins" call BetCard makes, guarded the same way: only
  // meaningful while there's still a winner left to decide.
  const preview = !mine || isTerminal
    ? null
    : isTwoOption
    ? getPariMutuelPreview(bet.bet_participants, mine.side!, currentUserId)
    : getOptionPariMutuelPreview(bet.bet_participants, mine.option_id!, currentUserId);

  // What actually happened, from the confirmed resolution -- see
  // lib/utils/betOutcome.ts for why every other resolution state (pending,
  // disputed, superseded, or no resolution at all) correctly falls out to
  // no outcome claim.
  const outcome = mine
    ? getBetOutcome(bet.bet_participants, bet.resolutions, currentUserId, isTwoOption)
    : ({ kind: "none" } as const);

  // BetWagerChart's "Net" line now carries the CONFIRMED outcome once one
  // exists (userPoolHistory is built from confirmedWinnerSide above), so a
  // settled loss draws its real flat-to-negative line instead of needing to
  // be hidden -- the workaround this used to require is gone.
  const showWagerChart =
    isTwoOption &&
    !canStillWager &&
    userPoolHistory !== null &&
    userPoolHistory.points.length > 0;

  return (
    <div className={cn("space-y-5", isTerminal && "opacity-70")}>
      {/* 1. What was bet -- the proposition leads, and its title is the
          largest thing on screen. */}
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight min-w-0">{bet.title}</h1>
          <div className="shrink-0 pt-1">
            <BetStatusBadge status={bet.status} />
          </div>
        </div>
        {bet.description && (
          <p className="text-muted-foreground text-sm">{bet.description}</p>
        )}
      </div>

      {/* 2. Where do I stand. */}
      <MyPosition
        stake={stake}
        mine={mine}
        mySideLabel={mySideLabel}
        preview={preview}
        outcome={outcome}
        isTwoOption={isTwoOption}
        totalPool={totalPool}
      />

      {/* 3. What happens next. */}
      <NextUp bet={bet} isResolving={isResolving} canStillWager={canStillWager} />

      {/* Everything else recedes: pool composition, charts, the per-side
          breakdown, wager limits, timestamps. */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-primary tabular-nums">
            {stake(totalPool)}
          </span>
          <span className="text-muted-foreground text-sm">in the pool</span>
        </div>

        {!isTerminal && isTwoOption && sideA && sideB && (
          <SplitBar leftValue={sideA.total} rightValue={sideB.total} />
        )}

        {isTwoOption && poolHistory && (
          <BetPoolChart
            data={poolHistory}
            sideALabel={bet.side_a_label}
            sideBLabel={bet.side_b_label}
            unit={bet.stake_unit}
            unitPlural={bet.stake_unit_plural}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          {isTwoOption && sideA && sideB ? (
            <>
              <SideList
                stake={stake}
                label={bet.side_a_label}
                rows={sideA.rows}
                total={sideA.total}
                currentUserId={currentUserId}
                highlighted={mine?.side === "a"}
              />
              <SideList
                stake={stake}
                label={bet.side_b_label}
                rows={sideB.rows}
                total={sideB.total}
                currentUserId={currentUserId}
                highlighted={mine?.side === "b"}
              />
            </>
          ) : (
            options.map((option) => {
              const totals = getOptionTotals(bet.bet_participants, option.id);
              return (
                <SideList
                  stake={stake}
                  key={option.id}
                  label={option.label}
                  rows={totals.rows}
                  total={totals.total}
                  currentUserId={currentUserId}
                  highlighted={mine?.option_id === option.id}
                />
              );
            })
          )}
        </div>

        {showWagerChart && userPoolHistory && (
          <BetWagerChart
            unit={bet.stake_unit}
            unitPlural={bet.stake_unit_plural}
            data={userPoolHistory.points}
            referenceOdds={userPoolHistory.referenceOdds}
            side={userPoolHistory.side}
            sideALabel={bet.side_a_label}
            sideBLabel={bet.side_b_label}
          />
        )}

        {(bet.min_wager != null || bet.max_wager != null) && (
          <p className="text-xs text-muted-foreground">
            {[
              bet.min_wager != null ? `Min wager ${stake(bet.min_wager)}` : null,
              bet.max_wager != null ? `Max wager ${stake(bet.max_wager)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        <p className="text-xs text-muted-foreground">Created {formatDate(bet.created_at)}</p>
      </div>
    </div>
  );
}
