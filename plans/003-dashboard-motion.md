# 003 — Dashboard motion: stagger the list, soften the tab swap

- **Status**: TODO
- **Commit**: 3df0897
- **Severity**: LOW (polish, not a defect)
- **Category**: Cohesion & tokens / Missed opportunities
- **Estimated scope**: 1 file plus a small CSS addition. Deliberately small.

Written against the **current** `app/(app)/dashboard/page.tsx`, which has changed twice since the
audit: the redesign (`1b1c28c`) and the delete feature (`8c47aa9`). Line numbers below are from
commit `3df0897`. Locate by content and stop if the content does not match.

## Problem

The dashboard has essentially no motion. A grep for `transition|animate|motion-safe|duration-`
across the whole file returns **one** match. Two specific seams:

**1. The list appears all at once.** Bets render as `filtered.map(...)` inside `TabsContent`
(around lines 206-230), rows at `md:` and up, `BetCard` below. Ten items arriving simultaneously
is a wall; a short stagger gives the eye an order to follow. The audit catalog puts the useful
range at **30-80ms** between items.

**2. Switching tabs teleports.** `TabsList` swaps `TabsContent` with no transition, so the entire
list is replaced in one frame. A brief fade prevents the jarring change and makes it obvious the
content is the *same list, filtered*, rather than a different screen.

Neither is a bug. Both are the difference between an app that feels considered and one that feels
assembled, which is what the "vibecoded" complaint was about.

## Constraints inherited from earlier plans

- Motion is **CSS only**. `motion` / `framer-motion` are NOT installed and must not be. This ships
  to a Cloudflare Worker and bundle discipline is an established value here (`378baf7`).
- Easing tokens are live from `e7262a8` at `app/globals.css:52-54`. Use
  `ease-[var(--ease-out)]`. A production build minifies the value to `cubic-bezier(.23, 1, .32, 1)`;
  if you grep built CSS, grep for `--ease-out:`.
- `prefers-reduced-motion` is handled globally at `app/globals.css:165`, with a skeleton exemption.
  Anything you add must still be correct if that rule strips it.
- This is an **Operate** surface. People arrive to do a task, not to watch it assemble. Motion here
  conveys state and hierarchy. It must never delay interaction.

## Target

**Stagger.** Give each list item an index-driven delay, capped so a long list does not turn into a
slow cascade:

```tsx
style={{ "--i": String(Math.min(i, 8)) } as React.CSSProperties}
```

with a CSS rule keyed off it. Cap at index 8 so item 30 does not wait 2.4 seconds. Total stagger
budget: **50ms per item, 400ms maximum**.

The animation is opacity plus a small `translateY` (no more than `4px`). **Items must be fully
visible and interactive if the animation never runs.** Animate from a visible default, or use
`@starting-style`; do not set `opacity: 0` as the resting state in a way that leaves content
invisible when animation is unsupported or stripped by reduced motion. This is the single most
important requirement in this plan: a dashboard that renders blank because an animation did not
fire is far worse than one with no animation.

**Tab swap.** A short fade on `TabsContent` entering, **120-160ms**, opacity only. No movement, no
scale. Switching a filter is not a page transition.

Add the keyframes to `app/globals.css` near the existing reduced-motion block, following the file's
existing conventions. Do not introduce a new CSS file.

## Boundaries

- Do **NOT** touch `components/bet/BetCard.tsx`, `components/bet/SideChoice.tsx`,
  `components/shared/SplitBar.tsx`, `components/bet/DeleteBetButton.tsx`, or
  `components/ui/tabs.tsx`. Add motion from the dashboard page and `globals.css` only.
- Do **NOT** change the ranking logic (`rankBet` / `sortBets`), the filter logic, the tab counts, or
  any copy.
- Do **NOT** touch the delete affordance or its positioning. It is a sibling of each row's `Link`
  for a reason: a `<button>` inside an `<a>` is invalid markup.
- Do **NOT** touch any query, action, route, schema, or SQL.
- Do **NOT** add dependencies. Do **NOT** add a light theme. No hardcoded colours.
- Another agent may be running plan 005 (token migration) across `components/`. Stay in
  `app/(app)/dashboard/page.tsx` and `app/globals.css`.
- If the code does not match this plan (drift since `3df0897`), **STOP and report**.

## Verification

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx tsc --noEmit
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npm test
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx next build
```

**Feel check.** `/dashboard` is behind Google OAuth and you cannot reach it. Do not attempt to sign
in. Verify instead at the source and CSS level, and say plainly in your report that you could not
watch it run:

- Confirm by reading the compiled CSS that the stagger rule and the tab fade both emitted.
- Confirm the resting state of a list item is **visible** — read the CSS and state which declaration
  guarantees an item is on screen when the animation does not run.
- Confirm the delay is capped and compute the worst-case total for a 30-item list. It must not
  exceed 400ms.

**Done when:** list items stagger within a 400ms budget, tabs cross-fade in 120-160ms, content is
provably visible without the animations, all three mechanical checks pass, and nothing outside the
two permitted files changed.
