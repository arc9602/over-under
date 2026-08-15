# 001 — Establish motion tokens and remove the three `transition: all`

- **Status**: TODO
- **Commit**: c2b7896
- **Severity**: HIGH
- **Category**: Easing & duration / Performance / Accessibility / Cohesion & tokens
- **Estimated scope**: 5 files, small — one CSS block plus three class-string edits

## Problem

This app has **no motion vocabulary at all**. `app/globals.css` defines zero easing tokens, zero
duration tokens, and zero `@keyframes`. Every animated surface reaches for a Tailwind default or a
hand-typed number, so nothing is coordinated and nothing can be tuned centrally. Grep results
across `components/` and `app/`: `duration-100` five times, `duration-250` once, `transition-all`
three times, `transition-colors` eleven times, and no custom curve anywhere.

**1. `transition: all` — three locations.** Animating `all` transitions unintended properties off
the GPU, including layout properties that trigger reflow:

```tsx
/* components/ui/button.tsx:7 — current */
"... whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring ..."

/* components/ui/badge.tsx:8 — current */
"... text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring ..."

/* components/ui/tabs.tsx:61 — current */
"... text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full ..."
```

These three are the most-touched components in the product — every button, every status badge,
every dashboard tab.

**2. Modal timing is under budget.** The dialog enters and exits in 100ms:

```tsx
/* components/ui/dialog.tsx:34 — current (backdrop) */
"... duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"

/* components/ui/dialog.tsx:56 — current (panel) */
"... duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 ..."
```

A modal is a substantial surface arriving; at 100ms it snaps rather than arrives.

**3. No reduced-motion handling anywhere.** A project-wide grep for `prefers-reduced-motion` and
`motion-reduce` returns **zero matches**, while `animate-in` / `animate-out` appear twelve times
across dropdown, select, dialog, and toast. Users who have asked their OS to reduce motion get the
full set.

## Target

Add to `app/globals.css`. **Copy these cubic-beziers exactly — do not approximate them:**

```css
@theme inline {
  /* ...existing entries stay... */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
}
```

Duration budgets from the catalog, to apply below:

| Element | Duration |
| --- | --- |
| Button press feedback | 100–160ms |
| Tooltips, small popovers | 125–200ms |
| Dropdowns, selects | 150–250ms |
| Modals, drawers | 200–500ms |

Replacements:

```tsx
/* components/ui/button.tsx:7 — target: name the properties */
"... whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-[var(--ease-out)] outline-none ..."

/* components/ui/badge.tsx:8 — target */
"... whitespace-nowrap transition-[color,background-color,border-color,box-shadow] duration-150 ease-[var(--ease-out)] ..."

/* components/ui/tabs.tsx:61 — target */
"... whitespace-nowrap text-foreground/60 transition-[color,background-color,box-shadow] duration-150 ease-[var(--ease-out)] ..."
```

Dialog moves from `duration-100` to `duration-200` at both `dialog.tsx:34` and `dialog.tsx:56`.
Leave `dropdown-menu.tsx` and `select.tsx` at `duration-100` — see Boundaries.

Reduced motion, added once in `app/globals.css`. Reduced motion means **fewer and gentler**
animations, not zero — keep opacity and color feedback, drop movement:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Exception that must be preserved:** `animate-pulse` on skeletons (`components/ui/skeleton.tsx`,
`components/shared/Skeletons.tsx`) communicates *loading*. Killing it entirely leaves a dead grey
block with no signal. Exempt skeleton pulse from the blanket rule — give it a reduced-motion
variant that still changes opacity, just slower and without implying motion.

## Repo conventions to follow

- **Tailwind v4, tokens via `@theme inline`.** Exemplar at `app/globals.css:42-44`, where
  `--color-win: var(--win);` is mapped so the `text-win` utility is generated. A variable declared
  outside `@theme` produces no utility — that exact mistake is what made the status colors inert
  for the entire life of this project until commit `8a88801`. Put easing tokens where they
  generate `ease-*` utilities, and **verify the utility actually compiles** before moving on.
- Class strings are single-line `cn(...)` arguments in `components/ui/*`. Match that formatting.
- This app is dark-only and deliberately so. Do not add a light-mode branch.

## Steps

1. `app/globals.css` — add the three easing tokens inside `@theme inline`.
2. Prove the tokens compile: use one in a component, run `npx next build`, and grep the emitted CSS
   under `.next/static/chunks/*.css` for the cubic-bezier value. If it is absent, **stop and
   report** — everything downstream depends on this.
3. `components/ui/button.tsx:7` — replace `transition-all` with the named property list above.
4. `components/ui/badge.tsx:8` — same.
5. `components/ui/tabs.tsx:61` — same.
6. `components/ui/dialog.tsx:34` and `:56` — `duration-100` → `duration-200`.
7. `app/globals.css` — add the reduced-motion block, with the skeleton exemption.

## Boundaries

- Do **NOT** touch `components/ui/dropdown-menu.tsx` or `components/ui/select.tsx`. Their
  `duration-100` is arguably below the 150–250ms guidance, but they are already correct on the
  things that matter more — both use `origin-(--transform-origin)` so they scale from their
  trigger, and both use `zoom-in-95` rather than `scale(0)`. Changing timing there is a taste call
  that belongs in its own reviewed change, not smuggled into a foundation commit.
- Do **NOT** touch `app/(app)/dashboard/page.tsx` — another agent is editing it right now.
- Do **NOT** touch `components/bet/*` or `components/market/*`. Those are plan 002.
- Do **NOT** change markup or structure. Motion and class strings only.
- Do **NOT** add dependencies.
- If a line does not match the excerpt above (drift since commit `c2b7896`), **STOP and report**
  rather than improvising.

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

All three must pass. Then grep the built CSS to prove the curve shipped:

```bash
grep -r "cubic-bezier(0.23, 1, 0.32, 1)" .next/static/chunks/ | head -2
```

Also confirm the removals landed:

```bash
grep -rn "transition-all" components/ app/
```

Expect zero matches.

**Feel check** — you cannot reach `/dashboard` (Google OAuth); do not attempt to sign in. Use
`/login`, which renders a button, and any page with a badge:

- A button's hover no longer animates properties it never should have (watch that nothing shifts
  layout on hover).
- In DevTools Rendering, enable "Emulate prefers-reduced-motion: reduce" and confirm dialogs still
  fade but no longer move, and that **skeletons still pulse** — a dead grey block is a regression,
  not a fix.

**Done when:** zero `transition-all` in `components/` and `app/`; the three easing tokens are
present in the built CSS; dialog is at `duration-200`; reduced motion is honored with the skeleton
exemption intact; all three mechanical checks pass.
