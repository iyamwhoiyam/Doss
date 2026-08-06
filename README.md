# Enova AMP — The Adaptive Manufacturing Platform

A product/platform marketing page for **Enova Science**, built to mirror the structure and
information architecture of [doss.com/products/platform](https://www.doss.com/products/platform)
— translated from Doss's generic operations-ERP positioning into Enova's actual business:
NSF-certified cGMP nutraceutical contract manufacturing.

## Run it

No build step, no dependencies. Open `index.html`, or serve the directory:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Structure

```
index.html            single page, semantic sections
assets/css/styles.css design tokens + components
assets/js/main.js     nav, tabs, scroll reveal, counters
```

## How the Doss page maps to Enova

Doss's platform page is organised around a thesis ("adaptive core beats rigid ERP"), three
no-code primitives, a module grid, a BI layer, an AI copilot, and integrations. Each of those
has a direct Enova counterpart:

| Doss | Enova AMP | Why |
|---|---|---|
| DOSS ARP — Adaptive Resource Platform | Enova AMP — Adaptive Manufacturing Platform | Same "composable core" thesis, scoped to a plant instead of a value chain |
| **Tables** — system of record | **Formulas** — system of record | The formula *is* the record in supplement manufacturing: spec, cost, and compliance in one row |
| **Forms** — inputs become actions | **Specs** — inputs become actions | RFQs, material receipts, deviations; validations fire at entry, not after the batch |
| **Workflows** — event-driven automation | **Runs** — event-driven automation | Batch routing across production rooms, with QA holds enforced in software |
| **DataStudio** — real-time BI | **QualityStudio** — real-time BI | Yield, cost variance, deviation rate, on-time release |
| **Dossbot** — AI copilot | **Enovabot** — AI copilot | Approval-gated writes, grounded answers, compliance-aware |
| Generic ERP modules | Formulation, Quoting, Procurement, Inventory & Lot Traceability, Production Planning, Quality, Testing & COA, Packaging, Fulfillment | The nine functions an Enova job actually passes through |

## Grounding

Copy and figures are drawn from Enova Science's own public positioning and from the
`enova-formulation-quote` skill's domain rules, so the product demos on the page show real
mechanics rather than placeholder text:

- 17 independent production rooms; two pharmacy operations; 5,000+ kg blending capacity;
  runs from 1,000 to 100,000+ units; founded 2009; Southwest Florida.
- NSF GMP, cGMP / 21 CFR 111, FDA-registered facility, USDA Organic ingredient support,
  Halal and Kosher options, Made in USA.
- The formula table applies the standard **5% overage** and computes the pectin gummy base as
  the **remainder** to hit total fill weight — the same math the quoting engine performs.
- The spec form shows a live **D3 upper-limit check** (UL 4,000 IU/serving).
- Item codes use the `ALT-RP-XXXX` convention.

## Assumptions

These are called out because they were choices, not facts on hand:

1. **The product name.** Enova has no publicly named software platform, so "Enova AMP" was
   coined as the direct structural analogue to "DOSS ARP". Trivially renameable — it appears in
   `index.html` only.
2. **The palette.** `enovascience.com` was unreachable from this environment (blocked by the
   session's network policy), so brand colours could not be sampled. The page uses a deep
   green-black base with a green accent — a defensible choice for a science/supplement brand,
   and defined entirely as CSS custom properties at the top of `styles.css`. Change
   `--accent`, `--bg`, and `--surface` to rebrand the whole page.
3. **Demo data is illustrative.** Batch numbers, lot IDs, ingredient prices, and dashboard
   figures are representative, not pulled from MISys or a real quote.
4. **Integrations listed are plausible for the stack** (MISys, QuickBooks, NetSuite, LIMS, 3PL,
   EDI) — confirm before publishing.

## Accessibility & compatibility

- Semantic landmarks, skip link, visible focus rings.
- Tabs implement the ARIA tabs pattern with arrow-key roving tabindex.
- Full `prefers-reduced-motion` support; all animation is suppressed.
- Responsive from 360px up; no horizontal page scroll (wide tables scroll in their own container).
- Works with JavaScript disabled — content is in the markup; only the tab panels collapse to
  the first panel.
