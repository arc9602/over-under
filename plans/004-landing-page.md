# 004 — Landing page: make the product the hero

- **Status**: TODO
- **Commit**: 8c47aa9
- **Severity**: HIGH (this is the only page a stranger sees before deciding to sign up)
- **Category**: Landing page redesign — composition overhaul, brand preserved
- **Estimated scope**: 2-4 files. One page, one font change, possibly 2 small client leaves.

Read this entire file before writing code. Then read `PRODUCT.md`. **You do not make design
decisions** — they are settled below. If something is genuinely unspecified, build everything else
and report the gap.

## Design read

**Consumer landing page for people who argue about outcomes in group chats, with a confident dark
sportsbook language, built on the existing Tailwind v4 + shadcn foundation.**

Dials: `DESIGN_VARIANCE: 8` · `MOTION_INTENSITY: 7` · `VISUAL_DENSITY: 3`

Mode: **redesign — overhaul the composition, preserve the brand.** Dark ground, lime primary, and
the `OVER/UNDER` wordmark are established identity and stay. The composition is effectively
greenfield: the current page is a placeholder.

## What is there now

`app/page.tsx` — a centered wordmark, a tagline, four icon rows, one button. A project-wide grep
returns **zero** transitions, animations, and hover states on this file. It is not a designed page;
it is a stub.

## Hard constraints that override the design skill

These come from the product and they win over any general design guidance:

1. **No fabricated social proof. None.** No logo wall, no "trusted by", no testimonials, no user
   counts, no volume figures, no avatar rows. `PRODUCT.md` is explicit: this product is pre-launch
   on a testnet with zero users and zero track record. The design skill will push for a trust strip
   under the hero. **Do not build one.** The mechanism is the only honest proof available.
2. **Dark only.** `app/globals.css` says "Always dark - betting app". Do not add a light mode, do
   not add `dark:` variants, do not add a theme toggle. One theme, locked.
3. **Keep `lucide-react`.** The design skill discourages it, but it is already the project's icon
   family and one family per project is the stronger rule. Do not install Phosphor or Tabler.
4. **No new animation library.** `motion` / `framer-motion` are NOT installed. Do not install them.
   This app ships to Cloudflare Workers and bundle discipline is an established value here — commit
   `378baf7` exists specifically to keep the wallet stack out of the Worker bundle. Motion comes
   from CSS, using the easing tokens that already exist (below).
5. **Zero em-dashes.** Not in headlines, body, buttons, alt text, or captions. Use a period, a
   comma, or a regular hyphen. This is binary, not a preference.
6. **Never imply the app holds money.** Bets are IOU. "Escrow", "deposit", "payout guaranteed",
   "we hold your funds" are all false on this surface.
7. **Payouts are pari-mutuel.** Any number shown as a potential return is an estimate that moves as
   people join. Never present one as fixed odds.

## Fix the font while you are here

`app/layout.tsx:2` imports **Inter**, the `create-next-app` default. Nothing about the brand chose
it. Replace it with **Geist** and **Geist Mono** via `next/font/google`:

```tsx
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
```

Apply both variables to the `<html>` or `<body>` className exactly where `inter.variable` is
applied now.

This also fixes a live bug: `app/globals.css:11` declares `--font-mono: var(--font-geist-mono)`,
but **`--font-geist-mono` is defined nowhere in the project.** Every `font-mono` utility currently
resolves to an undefined variable and silently falls back to the sans stack. Monospace has never
rendered as monospace in this app. Defining it fixes that everywhere at once.

Use `font-mono` deliberately on the landing page for **numbers and odds only** — never as a
"technical" costume for body copy.

## Imagery — read this carefully, it is the most likely thing to go wrong

There is **no image generation tool** available in this environment, and stock photography of
strangers means nothing for a private betting app between friends.

**Do NOT:**
- build a fake product screenshot out of `<div>` rectangles. This is the single most recognizable
  AI-design tell and it is banned outright.
- hand-roll decorative SVG illustrations.
- pull random `picsum.photos` photography that has nothing to do with the product.

**DO:** use the **real components** as the page's visual. The product's own UI is the honest
imagery, and it is genuinely the strongest asset available:

- `components/bet/SideChoice.tsx` — a real, working, tappable side picker.
- `components/shared/SplitBar.tsx` — the real pool-split bar.
- `components/bet/BetStatusBadge.tsx`, `components/bet/CountdownTimer.tsx`.

Render them with illustrative data. This is not a fake screenshot; it is the actual component.

## The composition

Five sections. At least four different layout families, per the skill's repetition rule. **Zero
eyebrows** — the small uppercase tracking labels above headings. The headline carries itself.

### 1. Hero — asymmetric split, interactive

Anti-center bias applies at `DESIGN_VARIANCE: 8`, and the current page is centered. Split it.

- **Left:** headline (max 2 lines, 3-6 words, so `text-5xl md:text-6xl lg:text-7xl` is in range),
  subtext (**max 20 words, max 4 lines**), one primary CTA plus at most one secondary.
- **Right:** a **live, tappable `SideChoice`** showing an illustrative bet. This is the hook. The
  visitor can pick a side before they have an account, on the landing page, and feel the product
  respond. That is what "draws them to click around."
- Max **4 text elements** total in the hero. No tagline under the CTAs, no trust micro-strip, no
  version label, no scroll cue.
- Hero top padding max `pt-24` at desktop. `min-h-[100dvh]`, never `h-screen`.
- CTA label: 3 words max, must not wrap at desktop. One label per intent across the whole page —
  if the hero CTA says "Start a bet", the footer CTA says "Start a bet" too, not "Get started".

### 2. How it works — three steps, not three cards

Three equal feature cards are banned, and so are "Step 1 / Stage 1" labels. Use the verb itself as
the label and a layout family that is not a card row: a vertical stepped rhythm, or an asymmetric
grid where the steps are different sizes.

The three real steps: **make the call**, **send the link**, **settle up**. Write your own copy;
keep each to a short heading plus one sentence under 25 words.

### 3. The odds move — the mechanism, with a real component

This is the honest differentiator and it deserves the page's most interesting moment. Pari-mutuel
means the odds shift as people join; it is not a fixed-odds book.

Use the real `SplitBar` with illustrative pool values to show a split. If you show a projected
return, it must read as an estimate that moves.

Layout family: full-bleed or near-full-bleed, distinct from sections 1 and 2.

### 4. Nobody holds your money — the trust section

Under the IOU model the app holds nothing. That is unusual, it is genuinely reassuring, and it is
completely honest. State it plainly:

- Over/Under does not hold your money.
- It records what was agreed and who owes whom.
- People settle between themselves.

Layout family: quiet and typographic. Distinct from the previous three. No cards.

### 5. Close — CTA and footer

One CTA, same label as the hero. Keep the footer minimal. **No version stamp, no locale strip, no
weather, no build info.**

## Motion — `MOTION_INTENSITY: 7`, from CSS only

Motion must be shown, not claimed. Every animation must justify itself in one sentence: hierarchy,
storytelling, feedback, or state transition. "It looked cool" is not a reason.

The easing tokens are already live from commit `e7262a8` in `app/globals.css:52-54`:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

Use `ease-[var(--ease-out)]`. Note a production build minifies the value to
`cubic-bezier(.23, 1, .32, 1)` — if you grep built CSS, grep for `--ease-out:`, and do not conclude
the token is missing because the unminified literal is absent.

Allowed techniques, in order of preference:

1. **CSS scroll-driven animations** (`animation-timeline: view()`) for scroll reveals. Zero
   bundle cost. **Content must be fully visible and readable when unsupported** — the animation
   enhances, it never gates content. Firefox does not support it; a visitor there must see a
   complete page, not blank sections.
2. **`@starting-style`** for entry transitions without JavaScript.
3. **`transition` on `transform` and `opacity` only.** Never animate `width`, `height`, `top`,
   `left`, or `margin`.
4. A stagger of **30-80ms** between items in a group reveal. Stagger must never delay interaction.

**Banned:** `window.addEventListener("scroll", ...)`, scroll progress in React state,
`requestAnimationFrame` loops touching state, infinite loops on every element, parallax,
scroll-hijacking, custom cursors, marquees (more than one per page is lazy filler; zero is right
here).

`prefers-reduced-motion` is already handled globally at `app/globals.css:165`. Any per-element
motion you add still needs its own `motion-reduce:` variant where the global rule does not reach.

## Repo conventions

- `cn()` from `@/lib/utils` for class composition.
- Colors from tokens only: `bg-background`, `text-foreground`, `text-primary`, `text-muted-foreground`,
  `bg-win`, `bg-loss`, `text-resolving`. **Never a raw palette class** like `text-emerald-400`.
  The status tokens work as of commit `8a88801`.
- `app/page.tsx` is a **server component** that redirects signed-in users to `/dashboard`. **Keep
  that redirect exactly as it is.** Push interactivity into `"use client"` leaf components; do not
  convert the page.
- One corner-radius system. The project uses `--radius: 0.625rem` with the `rounded-*` scale
  derived from it. Do not mix sharp and pill on the same page.
- Contain layout with `max-w-7xl mx-auto`. Standard breakpoints. Every multi-column section
  declares its `< 768px` collapse explicitly.

## Boundaries

- Do **NOT** touch `app/(app)/**`, `components/bet/BetCard.tsx`, `components/bet/SideChoice.tsx`,
  `components/shared/SplitBar.tsx`, or any dashboard file. You **import and use** those components;
  you do not modify them. Another agent may be editing them.
- Do **NOT** touch any query, server action, API route, validation schema, or SQL.
- Do **NOT** add dependencies. Not `motion`, not an icon library, not a font package beyond
  `next/font/google`.
- Do **NOT** change the `metadata` export's meaning, though improving the description is fine.
- Do **NOT** invent statistics, testimonials, brand partners, or user counts.
- If something does not match this plan (drift since `8c47aa9`), **STOP and report** rather than
  improvising.

## Copy self-audit before you finish

Re-read every visible string. Delete anything that is grammatically broken, has an unclear
referent, or reads like an LLM trying to sound thoughtful. Banned filler verbs: "elevate",
"seamless", "unleash", "next-gen", "revolutionize". Plain functional copy beats cute copy.

Check specifically: **zero em-dashes**, no invented numbers, no claim that money is held or a
payout is guaranteed.

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

All three must pass. Then:

```bash
grep -rn "—\|–" app/page.tsx app/layout.tsx
```

Expect zero matches. And confirm no raw palette classes:

```bash
grep -rnE "(text|bg|border)-(emerald|rose|amber|slate|zinc|gray|purple|violet)-[0-9]{3}" app/page.tsx
```

Expect zero matches.

**Feel check.** The landing page is public and needs no auth, so you **can** load it. Start the
dev server, open `/`, and confirm:

- The hero fits in one viewport at 1280x800 with the CTA visible without scrolling.
- The headline is at most 2 lines; the subtext is at most 4.
- The interactive side picker in the hero actually responds to a click.
- At 375px wide, every section is single-column and nothing overflows horizontally.
- Scroll reveals fire once and leave content visible, and the page is fully readable with
  JavaScript motion unsupported.
- In DevTools Rendering, "Emulate prefers-reduced-motion: reduce" leaves the page fully legible
  with movement dropped.
- Take a screenshot at desktop and at 375px and include what you saw in your report.

**Done when:** the hero is an asymmetric split with a working interactive element, five sections
use at least four layout families, there are zero eyebrows, zero em-dashes, zero fabricated proof,
zero raw palette classes, Geist and Geist Mono are wired, and all three mechanical checks pass.
