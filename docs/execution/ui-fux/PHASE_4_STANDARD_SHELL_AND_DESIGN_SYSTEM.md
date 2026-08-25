# Phase 4 — Standard shell and design system

Status: local implementation complete.

## Delivered primitives

- `StandardShell`: a dark-first responsive project frame with a stable top bar, results region and composer region.
- Desktop: results + a fixed-width `420px` composer column at the wide breakpoint.
- Mobile: results remain the primary screen; the composer opens in a bottom Sheet with safe-area padding instead of compressing all controls into a long page.
- `StandardMediaTabs`: semantic `tablist` / `tab` controls with arrow and Home/End keyboard handling.
- `StandardStatePanel`: independent loading, empty and error surfaces. A failure in one surface does not define the state of the whole workspace.
- Typed `en` and `ar` catalogs plus a single direction authority, replacing component-owned mixed UI text.
- Standard design tokens for canvas, surface, border, text and focus treatment; motion is reduced by the existing user preference rule.

## Boundaries preserved

The shell is non-billable. It has no provider call, no wallet mutation, no quote confirmation and no generation dispatch. The Phase 3 prototype remains a controlled fixture page and is not promoted over the existing studio yet. Phase 5 is responsible for wiring the real Image vertical slice through the engine.

## Verification

- `standard-shell.test.tsx`: shell direction, composition, keyboard tabs and isolated error retry.
- `StandardPrototypePage.test.tsx`: prompt-first discovery, progressive advanced settings and separate Arabic interface.
- Typecheck and production build pass locally.

## Gate 4 assessment

The reusable shell now supports Desktop, Tablet and Mobile layout boundaries, keyboard tabs, visible focus, reduced motion and independent locale direction. Full visual review on real target devices remains the human release check; no production deployment is implied by this phase.
