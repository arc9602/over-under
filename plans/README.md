# Motion plans — Over/Under

Produced by the `improve-animations` audit at commit `c2b7896`. Read-only audit: **no source code
was modified in producing these.** Each plan is self-contained and written for an executor with no
context from the conversation that generated it.

## Plans

| # | Title | Severity | Status | Depends on |
| --- | --- | --- | --- | --- |
| [001](001-motion-foundation.md) | Motion tokens + remove the three `transition: all` | HIGH | TODO | — |
| [002](002-press-feedback-and-pool-bar.md) | Press feedback + a pool bar that moves | MEDIUM | TODO | 001 |
| 003 | Dashboard motion: list stagger, tab crossfade | LOW | NOT WRITTEN | 001, delete-bet work |

## Execution order

**001 → 002.** 002 consumes the easing tokens 001 introduces; running it first produces class
strings that silently resolve to no easing — the same class of failure that left this project's
status colours inert for its entire history until commit `8a88801`.

003 is deliberately unwritten. `app/(app)/dashboard/page.tsx` is being modified by the delete-bet
work; writing a motion plan against line numbers that are about to move would produce a plan that
fails its own drift check. Write it once that lands.

## What the audit found

The vendored `components/ui/*` primitives are, for the most part, **already correct** — and that is
a real result, not a hedge:

- `dropdown-menu.tsx:44` and `select.tsx:86` use `origin-(--transform-origin)`, so they scale from
  their trigger rather than from centre.
- Both use `zoom-in-95`, avoiding the `scale(0)` mistake — nothing in the real world appears from
  nothing.
- `ease-in` appears **nowhere** in the codebase. It is the single most common motion smell and this
  project does not have it.
- `dialog.tsx` uses no `transform-origin`, which is correct: modals appear centred and are exempt.

What is genuinely missing is a **vocabulary** (001) and **physical feedback on the things people
touch** (002).

## Deliberately not proposed

- **Retiming `dropdown-menu` and `select`** off `duration-100`. Below the 150–250ms guidance, but
  those components are right about the things that matter more, and retiming them is a taste call
  that deserves its own reviewed change rather than riding along in a foundation commit.
- **Hover-scale effects anywhere.** Touch devices fire false hovers on tap; any such effect would
  need `@media (hover: hover) and (pointer: fine)` gating, and none is needed here.
- **Page-load entrance choreography.** This is an Operate-mode product — people arrive to do a
  task, not to watch it assemble. Motion here conveys state; it does not perform.
- **Celebration motion on resolution.** A win is genuinely a rare, high-emotion moment and the
  budget allows delight there. It is not proposed yet because the resolution surface has not been
  audited, and inventing a celebration for a flow I have not read would be a wishlist item rather
  than a finding.

## The landing page is not covered here

`app/page.tsx` has **zero** transitions, animations, or hover states — a project-wide grep returns
0. That is the one Persuade surface in the product and the only page a stranger sees before
deciding whether to sign up.

It is excluded from these plans on purpose. Motion there is a consequence of a visual direction
that has not been set, and the `improve-animations` catalog is tuned for product UI, not marketing.
Animating the current landing page would polish a composition nobody has designed yet. That surface
wants a design pass first; motion follows it.
