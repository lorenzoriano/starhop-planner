# Ghost FOV Circles for Upcoming Steps

**Date:** 2026-03-19
**Status:** Approved

## Summary

When a route step is active in the SkyChart, render faint amber dashed FOV circles at the center positions of all **upcoming** (future) steps. This gives the observer a spatial preview of where their telescope/binoculars will need to point next, without cluttering the view or obscuring the active step.

## Requirements

- Ghost circles appear for every hop where `index > animStep` (upcoming steps only)
- Past steps (index < animStep) get no ghost circle
- On the last step, `upcomingHops` is empty — no ghost circles render; this is correct and requires no special case
- Ghost circle color: amber (`rgba(245,158,11,...)`)
  - Fill: `rgba(245,158,11, 0.05)` (5% opacity)
  - Stroke: `rgba(245,158,11, 0.30)` (30% opacity)
  - Stroke width: 1px
  - Stroke dash: `4 4`
- Ghost shape follows `fovShape` prop (circle or rectangle), same dimensions as the active FOV
- Ghost circles are rendered **below the hop-dot markers and below** the active cyan FOV circle in SVG layer order so the active circle always wins visually

## Scope

**One file changed:** `client/src/components/SkyChart.tsx`

No new props, no new state, no changes to `planner.tsx` or `route-planner.ts`. All required data (`route`, `animStep`, `fovWidth`, `fovHeight`, `fovShape`, `project`) is already available in scope at the FOV rendering site.

## Implementation Detail

In `SkyChart.tsx`, locate the existing hop-dot markers block (lines ~695–722) and the active FOV block (lines ~724–750). Insert the ghost circles block **before the hop-dot markers block**, so the layer order from bottom to top is:

1. Ghost amber circles (new)
2. Toggle to show/hide ghost circles (new)
3. Hop-dot markers and step numbers (existing)
4. Active cyan FOV circle (existing)

The ghost block:

1. Guard: if `!route`, render nothing
2. Compute `upcomingHops = route.hops.filter((_, i) => i > animStep)`
3. For each upcoming hop:
   a. Call `const pt = project(hop.center.ra, hop.center.dec)`
   b. If `pt === null`, skip this hop (point is off-chart)
   c. Otherwise render a `<circle>` (when `fovShape === 'circle'`) or `<rect>` (otherwise) with amber ghost styles

The existing active-FOV block remains unchanged — it continues to render the bright cyan circle for `currentHop`.

## Visual Result

| Element | Color | Opacity | Style | Layer |
|---|---|---|---|---|
| Ghost FOV circles (upcoming) | Amber `#f59e0b` | Stroke 30%, Fill 5% | Dashed `4 4` | Bottom |
| Hop-dot markers + step numbers | Cyan/indigo/amber | various | Solid | Middle |
| Active FOV circle | Cyan `#4fc3ff` | Stroke 45%, Fill 5% | Solid | Top |
| Past steps | — | — | No circle | — |

## Out of Scope

- Different ghost styles for near vs. far upcoming steps
- Ghost circles for past steps
