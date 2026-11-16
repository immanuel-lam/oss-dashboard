# Design guidelines

These rules keep the dashboard calm and readable. Follow them for every new screen and every screen you change.
Customise the look as much as you like, using the tokens and patterns below.

## Purpose

Put useful numbers first. A visitor should see in a few seconds what changed and where. Keep functions accessible.
When you simplify, do not hide information.

## Calm presentation

- No eyebrows or kickers: no small uppercase or tracked labels above headings.
- Do not caption obvious controls, screenshots or illustrations.
- Say each fact once. Remove repeated destinations, times, statuses and instructions.
- Use sentence-case section headings only when they help people understand the content.
- Use familiar icons with accessible labels (`aria-label`). Keep visible text when an icon alone is ambiguous.
- Keep statuses short: "Waiting", "Failed", "2 min ago".
- Use hierarchy and spacing instead of extra labels, badges, cards or dividers.
- Put detailed explanations behind Help or a disclosure (`<details>`). Show interaction tips once.
- Keep warnings, errors, accessibility, legal attribution and necessary qualifications.

## Analytics presentation

- Sources with data come first. Unavailable sources go in an explicit disclosure.
- Use readable metric names (`metricNames` in `web/src/lib/metrics.ts`). Never show database identifiers.
- Show a missing value as a dash, never as 0. Zero stays zero.
- Label lifetime totals as lifetime, for example TikTok video views. Keep their coverage visible when it is
  incomplete. Never show a period change for them.
- Period changes: daily metrics compare each day with the same day one period earlier. Show the change only when at
  least half the days match, so reporting lag cannot fake a decline. Snapshots compare the first and last
  observation in the period. No change chip is better than a misleading one.
- Use one page heading, one date range and one reporting Help section.
- Keep units and time zones in the ledger and in chart titles. The visible selector shows source and metric. Add the
  unit only when it is not a count.
- One saved observation is not a trend. Show a sparse-state message instead.

## Visual system

- **Stack**: React, Tailwind 4, shadcn/ui primitives in `web/src/components/ui`, lucide icons, Recharts and
  `motion`.
- **Tokens**: all colours live in `web/src/index.css`. `:root` holds the dark theme (the default) and `.light`
  holds the light theme. They map onto shadcn's variable names. Components read tokens only. When you need a new
  colour role, add a token; never write a literal colour in a component.
- **Shell**: the sidebar sits on `--shell`. The workspace is one inset sheet (`--background`, 16px radius). Panels and
  tiles use `--card`, a 1px `--border`, 12px radius and `--shadow-card`. On phones, a floating bottom tab bar
  replaces the sidebar.
- **Tiles**: source glyph and name, a period change chip, the value, the metric name and a sparkline. Show coverage
  only when it is incomplete. No footers or captions.
- **Charts**: one accent series, plus a muted previous-period line only when it exists. Solid hairline grid, smooth
  monotone curves that bridge missing days (never drawn as zero) and a crosshair tooltip. Exact values go in an
  accessible "Chart values" disclosure. Never use a second y-axis.
- **Chart flow**: selecting a tile selects its source. A small tab row in the chart header selects the metric, with
  the headline metric first. "All metrics" lists every series grouped by source. On phones, choosing a tile scrolls
  the chart into view.
- **Motion signals status only**: a count-up on changed values, a line draw-in on a new series or range, staggered
  tile entry on first render, a shimmer while loading, and a spinning refresh icon while reading. Everything stops
  under `prefers-reduced-motion` (`MotionConfig reducedMotion="user"` plus the CSS rule in `index.css`). No
  decorative animation.

## Final review before handing off UI work

Read every visible string in each changed view, including the empty, loading, error and expanded states. Remove
repetitions, obvious instructions and text that adds no meaning. Check desktop width and 390px phone width, both
themes, keyboard focus and labels, and every existing action. A passing build does not prove the visual quality. If
you can, look at the result in a browser.
