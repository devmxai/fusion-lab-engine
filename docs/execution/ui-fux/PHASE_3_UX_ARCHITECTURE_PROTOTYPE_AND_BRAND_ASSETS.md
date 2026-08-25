# Phase 3 — UX architecture, prototype, and brand assets

Status: implemented locally; visual approval remains a product-review gate.

## Image-first journey

`Choose published image offer → describe image → set Essentials → optional Advanced settings / references → inspect final quote → Generate → pending card → settled result`

The Phase 3 prototype is intentionally non-billable. It reads the exact `PublishedOffer` v2 fixture and uses `evaluatePublishedOfferControls`; it has no provider, engine, wallet, or API call.

## Wireframes

### Desktop — English LTR

```text
+ Top bar: project | Standard / Space | language
+----------------------------------+-------------------+
| Session / generated results      | Create image      |
| Empty → pending → result         | model             |
|                                  | prompt            |
|                                  | Essentials        |
|                                  | Advanced (closed) |
|                                  | references        |
|                                  | quote + generate  |
+----------------------------------+-------------------+
```

### Desktop — Arabic RTL

The same shell mirrors direction: composer is on the right, text and reading order are RTL, and all user-interface copy comes from the Arabic catalog. Product names and provider/model identities remain registered names.

### Mobile — both locales

```text
Top bar
Result / session area
Composer sheet: model → prompt → Essentials → Advanced → quote → Generate
```

There is no mobile-only hidden capability: the same released controls render, while advanced controls remain deliberately collapsed.

## Accessibility and disclosure

- Native labelled inputs, buttons, selects, and visible keyboard focus.
- Generate is disabled until the required prompt exists, preventing a dead-end click.
- Advanced controls render only after deliberate expansion.
- The CSS reduced-motion rule from Phase 0 applies to the Creative Space root; Phase 4 will extract global motion tokens.

## Brand asset manifest

| Asset | Rendering now | Official source | License / adoption decision | Fallback |
|---|---|---|---|---|
| FusionLab identity | Original `Sparkles` UI mark + `FUSIONLAB` text | Product-owned | Internal product identity | Text only |
| KIE.ai | Registered name as text only | [KIE official docs](https://docs.kie.ai/1973359m0) | No provider binary asset adopted; no unverified licence assertion | Generic provider icon + text |
| OpenRouter | Registered name as text only | [OpenRouter brand announcement](https://openrouter.ai/blog/announcements/brand-refresh/) | New external brand exists, but no binary file is embedded until explicit usage terms/asset package are recorded | Generic provider icon + text |

No monogram impersonation, third-party CDN hotlink, or copied provider logo is in the prototype. Light/dark treatment is semantic text/icon colour, so it does not require a duplicated external logo file.

## Local verification

- `StandardPrototypePage.test.tsx` checks prompt-to-generate discovery, progressive Advanced controls, Arabic direction, and separated English/Arabic labels.
- Fixture evidence hashes and identity satisfy the Phase 2 `PublishedOffer` v2 contract.

## Gate 3 outcome

The local prototype permits a first-time user to complete a mock image generation with a single prompt and no technical explanation. Every visible setting originates from a declared v2 control; each external brand has an explicit source/adoption decision. Product-design visual approval is the remaining human sign-off before Phase 4 promotes this shell.
