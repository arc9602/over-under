# 002 — Press feedback on the things people actually click, and a pool bar that moves

- **Status**: TODO — **BLOCKED on 001** (uses the easing tokens it introduces)
- **Commit**: c2b7896
- **Severity**: MEDIUM
- **Category**: Physicality & origin / Missed opportunities / Performance
- **Estimated scope**: 3 files, small

## Problem

**1. The single most important interaction in the product has no press feedback.**
`components/bet/SideChoice.tsx` is the focal control on both invite-arrival pages — the moment a
stranger from a group chat picks a side. It is the conversion event of the entire funnel. Its
entire motion vocabulary is a colour fade:

```tsx
/* components/bet/SideChoice.tsx:54 — current */
"relative flex min-h-11 cursor-pointer flex-col justify-center gap-1 rounded-lg border-2 p-3 transition-colors",
/* :57 */
: "border-border bg-secondary/40 hover:bg-secondary/60"
```

Nothing acknowledges the press. The catalog is specific: pressable elements want
`transform: scale(0.97)` on `:active` with `transition: transform 160ms ease-out`, kept subtle in
the 0.95–0.98 range.

**2. Bet cards are large tap targets with no press response.**

```tsx
/* components/bet/BetCard.tsx:79 — current */
"transition-colors cursor-pointer",
```

The whole card is a link. On touch especially, a card that visibly compresses under the finger
reads as responsive; one that only changes border colour reads as a static list.

**3. The pool bar teleports, and it animates the wrong property.**
`components/shared/SplitBar.tsx:31,33` sets width inline:

```tsx
<div className={cn("h-full rounded-full", leftColorClassName)} style={{ width: `${leftPct}%` }} />
```

Two problems. It never transitions — when the split changes the bar jumps. And `width` is a layout
property: animating it triggers reflow and paint. The catalog is unambiguous — animate `transform`
and `opacity` only.

This bar is the visual representation of money moving between two sides. It is the one place in
the product where motion would carry actual meaning rather than decorate.

## Target

**SideChoice** — add press feedback and a token-driven transition. Keep every existing class:

```tsx
/* target — append to the base class string at :54 */
"... transition-[background-color,border-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100"
```

**BetCard** — same treatment, gentler because the target is larger:

```tsx
/* target — at BetCard.tsx:79 */
"transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-[var(--ease-out)] cursor-pointer active:scale-[0.99] motion-reduce:active:scale-100",
```

**SplitBar** — switch from animating `width` to transforming a full-width element, so the motion is
GPU-composited:

```tsx
/* target — replace the two segment divs */
<div className="h-full flex-1 origin-left overflow-hidden rounded-full">
  <div
    className={cn("h-full w-full rounded-full transition-transform duration-300 ease-[var(--ease-out)] motion-reduce:transition-none", leftColorClassName)}
    style={{ transform: `scaleX(${leftPct / 100})`, transformOrigin: "left" }}
  />
</div>
```

Apply the mirror of this to the right segment with `transformOrigin: "right"` and
`scaleX(rightPct / 100)`.

**Do not change SplitBar's zero guard.** `if (total === 0) return null;` at line 25 exists because
a 50/50 bar with no money drew even odds out of thin air. It stays exactly as it is, including its
comment.

If the flex/scaleX restructure cannot preserve the current visual result — same heights, same
`gap-px` seam, same rounded ends — **stop and report** rather than shipping a bar that looks
different. Matching the existing appearance is a hard requirement; only the motion changes.

## Repo conventions to follow

- Easing tokens come from plan 001 (`--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`). **001 must land
  first.** If `ease-[var(--ease-out)]` produces no easing, 001 is incomplete — stop and report.
- Class composition is always `cn(...)` from `@/lib/utils`. Exemplar: `components/bet/BetCard.tsx:78-85`.
- `motion-reduce:` variants are the per-component escape hatch alongside 001's global media query.
- Colours come from tokens only — `bg-win`, `bg-loss`, `text-resolving`. Never a raw palette class.

## Steps

1. Confirm 001 is merged and `--ease-out` resolves in the built CSS. If not, stop.
2. `components/bet/SideChoice.tsx:54` — extend the base class string as shown. Change nothing else
   in the file; its radio semantics and keyboard handling are correct and out of scope.
3. `components/bet/BetCard.tsx:79` — extend the class string as shown. Do not touch the
   state-differentiation logic at `:82-84`, the outcome branches, or anything from `betOutcome.ts`.
4. `components/shared/SplitBar.tsx` — restructure the two segments to transform instead of width,
   preserving the zero guard and the existing appearance.

## Boundaries

- Do **NOT** touch `app/(app)/dashboard/page.tsx`. It is being edited by another agent, and its
  own motion (list stagger, tab crossfade) is plan 003.
- Do **NOT** touch `lib/utils/betOutcome.ts`, `lib/queries/*`, any server action, any API route, or
  any SQL.
- Do **NOT** change SideChoice's radio semantics, arrow-key handling, or `min-h-11` touch target.
- Do **NOT** add hover-scale effects. Touch devices fire false hovers on tap; the catalog gates
  hover motion behind `@media (hover: hover) and (pointer: fine)`, and no such effect is requested
  here.
- Do **NOT** add dependencies.
- If a line does not match the excerpt above (drift since `c2b7896`), **STOP and report**.

## Verification

**Mechanical:**

```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx tsc --noEmit
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npm test
```
```bash
$env:Path = "C:\Program Files\nodejs;$env:Path"; npx next build
```

All must pass. Then confirm no layout-animating property was introduced:

```bash
grep -rn "transition-\[.*width\|transition-all" components/bet components/shared
```

Expect zero matches.

**Feel check** — `/dashboard` is behind Google OAuth; do not attempt to sign in. `SplitBar` and
`SideChoice` can be exercised on an invite page or in isolation:

- Pressing a side visibly compresses it and releases cleanly. It must feel like a button, not a
  checkbox.
- The compression is subtle — if it reads as "bouncy," it is too much; the target is 0.97.
- In DevTools Animations, set playback to 10% and confirm the pool bar **scales** from its edge
  rather than the segments changing width (watch the Layout column in Performance — there should be
  no layout thrash while it moves).
- Enable "Emulate prefers-reduced-motion: reduce" and confirm presses no longer scale and the bar
  jumps rather than slides, while colour and opacity feedback survive.

**Done when:** pressing a side and a card gives immediate physical feedback; the pool bar moves via
transform with no layout recalculation; reduced motion drops the movement but keeps the feedback;
the bar looks identical to before at rest; all three mechanical checks pass.
