# Sky Journeys: UX design

Status: design proposal, phase 1 (no code changed). Author: UX design (team member 06).
Audience: the orchestrator and the implementer agents for the journey UI, the journey assembler and the knowledge base.

This document is opinionated on purpose. Where I write **Decision**, treat it as the default unless another team document overrides it with a stated reason.

---

## 0. What I studied, and what it means for the design

I read `client/src/pages/planner.tsx` (2,224 lines, every page in one component), `BinocularGuide.tsx`, `SkyChart.tsx`, `NightVisionFilter.tsx`, `HopFieldNavigation.tsx`, `BinocularAssessment.tsx`, `lib/navigation.ts`, `lib/hop-progress.ts` and the data files listed in section 13. I also captured Playwright screenshots of the current app on a 390×844 phone and a 1440×900 desktop, set to San Francisco, Jan 15 2026, 20:30, using `/usr/bin/google-chrome` with playwright 1.64 from the npx cache. The dev server I started has been stopped. The relevant findings:

| Observation in the current app | Consequence for Sky Journeys |
|---|---|
| The main nav already has 7 tabs (Tonight, Planner, Clock, Catalog, Binoculars, Moon, Star hop). On a 390 px phone it scrolls horizontally, and "Binoculars" is clipped at the right edge. | A new tab must go in **slot 2**, or it will be invisible on phones. |
| On a phone, Star hop spends about 610 px on chrome (header, nav, timebar, destination search, target bar and route setup) before the field map begins. | Field use needs a separate **focus mode** that hides all app chrome. Reusing the Star hop page layout as it stands would fail one-handed use. |
| Red light is a global SVG filter that maps every pixel to **luminance only** (`feColorMatrix` → R channel = Rec.709 luma). | Information carried by **hue alone disappears** in red mode. Star colour swatches, region tints and HR-diagram colour ramps must also be encoded with luminance, shape or a text label. |
| The survey photographs (`binocular-images/*-optical.jpg`, DSS2) are framed at **3.7°, the same true field as the default 14×50 binocular**. Infrared 2MASS twins and 20 licensed "featured" telescope photos also exist. | A same-scale "this is your field" photo already exists, which is the best expectation-management asset we have. The infrared twin is a ready-made teaching image for nurseries and dust. |
| `binocular-guide-extra.json` has `impression` (what binoculars show), `finding`, `level` and `equipment` for 179 targets. `binocular-observation-references.json` links to real binocular sketches for 28 targets. | Use `impression` as the seed of the "what you will see" line, and the sketches as a third expectation reference. |
| Route planning starts from a bright **BSC star** (`startStarId`) and produces `route.hops[]`, each with `instruction`, `distanceDeg`, `direction`, `pattern` and `patternScore`. | Legs between stops reuse this. A stop that is a deep-sky object cannot be a `startStarId` today, so see the API need in section 6.3. |
| Hop progress is persisted (`starhop-hop-progress-v1`, 8 h expiry, route fingerprint). | Copy this pattern for journey progress. |
| The text-size control (`data-text-size`) and observation logging (`markObserved`, sessions) exist. | Journeys log into the active session, so no new storage silo is needed for observations. |

---

## 1. Principles (the five rules every screen obeys)

1. **Eyes up, not on the phone.** In the field the phone is a glance device. Every in-field screen answers "what do I do now" within 3 seconds and fits one screen without scrolling. Deeper reading is optional and below the fold.
2. **Manage expectations before wonder.** Show what 14×50 binoculars will actually show (a grey glow, a pair of points) **before** the long-exposure photo. A disappointed beginner quits; one who was told "it's a faint grey smudge, and that smudge is 1,350 light-years of glowing hydrogen" stays. Faint nebulae look grey because dim light is seen by rod cells, which do not sense colour ([Astronomy.com, "Am I seeing the real thing?"](https://www.astronomy.com/science/am-i-seeing-the-real-thing/); [Bell Museum](https://www.bellmuseum.umn.edu/?p=14394)).
3. **Every stop earns its place, and every move earns its direction.** Each card states *why this object* and *why we came here from the previous one*. This applies Tilden's interpretation principle that information which does not relate to the visitor's experience is "sterile", and that the aim is provocation, not instruction ([NPS, Meaningful Interpretation](https://www.nps.gov/parkhistory/online_books/eastern/meaningful_interpretation/mi2a.htm); [Museums Association summary of Tilden](https://www.museumsassociation.org/museums-journal/opinion/2026/10/creating-meaningful-museum-experiences/)).
4. **See, Understand, Wonder, Connect.** Content is layered in that order, adapted from Harvard Project Zero's *See, Think, Wonder* routine, which moves from careful observation to interpretation to questions ([Project Zero](https://pz.harvard.edu/resources/see-think-wonder)), and from its *See, Wonder, Connect* variant ([PZ PDF](https://pz.harvard.edu/sites/default/files/2026-03/See%2C%20Wonder%2C%20Connect%20x2.pdf)).
5. **Protect night vision and one hand.** Dark surfaces, red-mode safety, photos dimmed by default in field mode, primary actions in the bottom thumb zone, and touch targets of at least 48 px (Material guidance; WCAG 2.5.5 AAA asks for 44 CSS px — [Deque](https://dequeuniversity.com/resources/wcag2.1/2.5.5-target-size), [CraftCMS summary](https://craftcms.com/blog/accessible-target-sizes)). Red light preserves dark adaptation because rods are nearly insensitive to long wavelengths while cones still read it ([MWS, protecting night vision](https://www.mwsmag.com/protecting-night-vision-with-lighting/)), so the existing red mode must work everywhere in journeys.

---

## 2. Where it lives and what it is called

**Decision: a new top-level tab named "Journeys", in nav slot 2 (right after Tonight).**

- Feature name in headings and marketing copy: **Sky Journeys**. Tab label: **Journeys**, because it is short and fits the 390 px nav without clipping. Icon: lucide `Waypoints`, since `Navigation` is already taken by Star hop.
- New nav order: Tonight · **Journeys** · Planner · Clock · Catalog · Binoculars · Moon · Star hop.
  Rationale: this is the feature built for the target persona, a curious binocular owner. Tonight answers "what's up?". Journeys answers "show me something wonderful, and explain it". In slot 2 it is visible on phones without horizontal scroll.
- Hash routes, added to `lib/navigation.ts` (`Page` gains `"journeys"`):

| Route | Screen |
|---|---|
| `#/journeys` | Discovery (tonight's suggestions) |
| `#/journeys/:journeyKey` | Overview of one journey |
| `#/journeys/:journeyKey/stop/:n` | Field mode at stop *n* (1-based) |
| `#/journeys/:journeyKey/done` | Journey summary |

`journeyKey` is a short, URL-safe encoding of `themeId + stop ids + planned start (UTC minute)`, for example `life-cycle~M45.Hyades.M1.Betelgeuse.M42~202601160430`. A reload or bookmark therefore regenerates the same journey deterministically. The generated journey object is also cached in `localStorage` (`starhop-journey-v1`, zod-validated, same 8 h live-expiry rule as `hop-progress.ts`). If the reloaded conditions no longer satisfy the constraints (for example the time moved and stop 1 has set), show a banner and offer "Rebuild for now". Never silently change the stops.

### 2.1 Entry points (into Journeys from elsewhere)

| Where | What | Behaviour |
|---|---|---|
| **Tonight**, directly below the planetarium panel and above "Compare upcoming nights" | "Tonight's journey" teaser card: the top-ranked journey's title, hook, number of stops, duration, mini path thumbnail, plus **Start journey** and **More journeys →** | Hidden when nothing qualifies; it is replaced by a one-line reason ("Bright Moon until 01:40 — journeys open after moonset"). |
| **Binoculars** page, under the "Twelve chapters" month heading | A banner: "Turn this month's sky into a story → Sky Journeys" | Opens Discovery with the binocular date/time of the page (honours its own date controls). |
| **Binocular target detail** dialog | A chip: "Part of 2 journeys tonight" | Opens Discovery filtered to journeys containing that object. |
| **Star hop**, when the destination is a stop of the active journey | A thin bar: "You're on *Cradle to Grave* · stop 3 of 5 · Back to journey" | Returns to field mode at the same stop. |
| **Planner** | In "Export & more": **Add a journey to this night** | Inserts the stops into the session in journey order with their scheduled slots. |
| **Featured object** on Tonight | Same chip as in the binocular dialog | — |

There is **no** journeys entry in Moon or Clock in v1.

---

## 3. User journeys (the flows the screens must support)

1. **"I'm outside now, show me something."** Open the app → tap Journeys → see 3 suggestions → tap one → overview (5 s) → **Start** → pre-flight sheet → field mode → stop 1 … stop N → summary. Target: under 4 taps from cold start to stop 1.
2. **"Plan for Saturday."** Journeys → change "When" to Sat 21:00 → pick → **Add to night** → Planner shows the stops with slots. On Saturday, Planner (or the Tonight teaser) has **Resume journey**.
3. **"Lost at stop 3."** Field mode → **Can't find it** → help sheet (re-show hop, averted-vision tip, "it may be too low or the sky too bright") → **Skip** → the stop 4 transition text adapts to the skip (section 6.5).
4. **"I'm a learner, not in the field" (desk/couch).** Journeys → overview → read cards in "Read mode" (scrolling, all layers open, larger photos, no pre-flight).

---

## 4. Screen A: Journey discovery

### 4.1 Content of each journey card

| Element | Spec | Example |
|---|---|---|
| Theme title | 40 characters or fewer, evocative, no jargon | **Cradle to Grave** |
| Hook line | 90 characters or fewer, one sentence, a question or a promise | "Follow a star's whole life — from nursery to wreckage — in one sweep of the winter sky." |
| Story arc chips | One chip per stop, using the stop's *role* label (up to 3 words) joined by "→". Collapse to "… +2" past 5. | Teen cluster → Middle age → Shattered star → Doomed giant → Nursery |
| Stops | Count | 5 stops |
| Duration | Estimated minutes, rounded to 5, assuming 6–10 min per stop (the assembler provides it) | ~45 min |
| Region | Compass direction + altitude band, in words | South-east · 35–70° high |
| Difficulty | 3 levels with a one-word explanation tooltip: **Easy** (everything visible in 30 s), **Moderate** (one faint or tricky stop), **Stretch** (at least one challenge-level target, dark sky needed) | Moderate · one faint stop |
| Best window | Local times when every stop satisfies the constraints | Best 20:10–22:40 |
| Mini sky map | 96×96 px dome thumbnail: horizon circle, region wedge, numbered dots, path line | — |
| Status | "Fits now" / "Starts at 21:10" / "Ends soon (stop 1 sets 22:05)" | — |

### 4.2 Controls (one row of chips plus one disclosure)

- **Theme**: horizontally scrolling chips, **Surprise me** (default) · Lives of stars · Giants & dwarfs · Star colours · Nurseries · Star corpses · Doubles & families · Clusters young & old · Far-away galaxies · Light-time machine. The exact theme catalogue belongs to the knowledge-base and assembly docs; UX needs ids, short labels and a 1-line description per theme.
- **Length**: segmented control, **Short** (3–4 stops, ~20 min) · **Medium** (5–6, ~40 min, default) · **Long** (7–10, 60+ min).
- **When**: "Now" (default in live mode) / "Starting at [time]". This uses the shared date bar; a change here *previews* the time like other pages do (`previewMoment`).
- Disclosure **More options**:
  - **Facing / open sky**: an 8-way compass multi-select ("I can see: S, SE, E"), persisted per saved location. This is the single most useful real-site control, because trees and houses block parts of the sky. Default: all directions.
  - **Minimum altitude**: defaults to the assembler's value (I recommend 25° for binocular deep-sky; the assembler doc decides).
  - **Include challenge objects**: on/off.
- The discovery screen shows **3 journeys by default**, with **Show 3 more** below. Too much choice paralyses a beginner. A **Shuffle** icon re-seeds; ranking is deterministic per (night, site, seed), so screenshots and tests are reproducible.

### 4.3 "Why options are limited" (the conditions explainer)

A **conditions strip** always sits at the top. When conditions remove options, a **limiter panel** explains it in plain words, says what it costs, and offers the fix. Use the existing `ExplainedStatus` pattern (label + tap for detail).

| Condition (computed today in `observing.ts` / `moon.ts` / weather cache) | Message pattern | Offered actions |
|---|---|---|
| Bright Moon up (for example ≥ 60 % lit and above the horizon) | "The Moon is 92 % lit in Gemini. Its glow washes out faint nebulae and galaxies, so we're keeping journeys at least 40° away from it and favouring stars, doubles and bright clusters. **4 faint-object themes are paused tonight.**" | **Show moon-friendly journeys** (default) · **After moonset (01:40)** · **Explore the Moon itself →** (Moon tab) |
| Twilight (Sun between −18° and 0°) | "The sky is still brightening/fading. Until 19:10, only bright stars and doubles show well. Deep-sky journeys open at 19:10." | **Start a twilight journey** · **Jump to 19:10** |
| Daylight | "It's daytime here. Plan for tonight?" | **Plan tonight (dark at 18:47)** |
| Clouds (cached forecast available and > 60 % cover) | "Forecast: 80 % cloud until 23:00 (cached 14:10, may be out of date). Journeys still shown — try anyway or plan for clearer hours." | **Clearer at 23:00 →** |
| Forecast unavailable or offline | Small muted line: "No cloud forecast offline — the sky itself is the forecast." | — |
| Obstructions (facing filter) remove most options | "Only the south-east is open from here, so 2 journeys fit." | **Edit open sky** |
| Nothing fits | Empty state, section 4.5 | — |

Every journey shown must satisfy the hard constraints. The limiter panel is how users learn that the app *is* respecting the Moon, altitude and darkness, which builds trust.

### 4.4 Phone wireframe: Discovery (390×844)

```
┌──────────────────────────────────────┐
│ StarHop.            [⚙] [●] [☾red]   │  ← existing header
│ Tonight │Journeys│ Planner  Clock  … │  ← Journeys in slot 2
├──────────────────────────────────────┤
│ SKY JOURNEYS                         │
│ Where will the sky take you?         │
│ ┌──────────────────────────────────┐ │
│ │ Thu Jan 15 · 20:30 · SF          │ │  conditions strip (tappable)
│ │ ● Dark until 05:51  ☾ 7% · down  │ │
│ │ 14×50 · 3.7° field   Offline ✓   │ │
│ └──────────────────────────────────┘ │
│ [Surprise me][Lives of stars][Neb…▸ │  theme chips (h-scroll)
│ ( Short | •Medium• | Long )  [Now ▾] │
│ ▸ More options (open sky, altitude)  │
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │ ╭────╮ CRADLE TO GRAVE     Fits  │ │
│ │ │ ·①·│ Follow a star's whole     │ │
│ │ │②·③ │ life — nursery to wreckage│ │
│ │ ╰────╯ in one sweep of sky.      │ │
│ │ Teen cluster → Middle age →      │ │
│ │ Shattered star → … +2            │ │
│ │ 5 stops · ~45 min · SE 35–70°    │ │
│ │ Moderate · one faint stop        │ │
│ │ [  Start  ]        [ Preview › ] │ │  both ≥48 px tall
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ╭────╮ GIANTS AMONG US  Fits now │ │
│ │ ...                              │ │
│ └──────────────────────────────────┘ │
│ ┌ 3rd card ┐                         │
│      [ Show 3 more ]   [⟳ Shuffle]   │
└──────────────────────────────────────┘
```

Limiter variant (bright Moon), inserted between the controls and the first card:

```
│ ┌──────────────────────────────────┐ │
│ │ ☾ Bright Moon (92%) until 01:40  │ │
│ │ Faint nebulae & galaxies are     │ │
│ │ washed out. We kept every stop   │ │
│ │ ≥40° from the Moon and favoured  │ │
│ │ stars, doubles and clusters.     │ │
│ │ 4 themes paused tonight  (why?)  │ │
│ │ [After moonset 01:40] [Moon tab›]│ │
│ └──────────────────────────────────┘ │
```

### 4.5 Empty state ("nothing fits")

```
│  No journey fits right now.          │
│  · Stop candidates are below 25°     │
│    in your open sky (S only).        │
│  · The Moon is 98% and high.         │
│  Try:  [Open more sky] [Lower to 15°]│
│        [Tomorrow 21:00] [Moon tab ›] │
```

Rules: always list the **binding** constraints, at most 3 and in plain words, and give at least 2 actions. Never show an empty list without a reason.

### 4.6 Desktop wireframe: Discovery (1440 wide)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ StarHop.   Tonight  [Journeys]  Planner  Clock  Catalog  Binoculars  Moon  Star hop  [⚙][●][☾]│
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ SKY JOURNEYS                                       │ Thu Jan 15 2026 · 20:30 · San Francisco  │
│ Where will the sky take you tonight?               │ Dark 18:47–05:51 · Moon 7% (below hor.)  │
│ Short guided tours for binoculars: what to see,    │ 14×50 · 3.7° · Offline ready ✓           │
│ and why it matters.                                │                                          │
├────────────────────────────────────────────────────┴──────────────────────────────────────────┤
│ Theme [Surprise me][Lives of stars][Giants & dwarfs][Nurseries][Corpses][Doubles][Galaxies]… │
│ Length (Short|•Medium•|Long)   When [Now ▾]   Open sky [N NE E SE S SW W NW]   Min alt [25°] │
├──────────────────────────────┬──────────────────────────────┬────────────────────────────────┤
│ ╭───────╮ CRADLE TO GRAVE    │ ╭───────╮ GIANTS AMONG US    │ ╭───────╮ THE COLOUR OF HEAT   │
│ │  dome │ Follow a star's    │ │  dome │ …                  │ │  dome │ …                    │
│ │  path │ whole life …       │ │       │                    │ │       │                      │
│ ╰───────╯                    │ ╰───────╯                    │ ╰───────╯                      │
│ Teen cluster → Middle age →  │ …                            │ …                              │
│ Shattered star → Doomed      │                              │                                │
│ giant → Nursery              │                              │                                │
│ 5 stops · ~45 min · SE 35–70°│                              │                                │
│ Moderate · Best 20:10–22:40  │                              │                                │
│ [Start]  [Preview]           │ [Start]  [Preview]           │ [Start]  [Preview]             │
├──────────────────────────────┴──────────────────────────────┴────────────────────────────────┤
│                                [Show 3 more]   [⟳ Shuffle]                                    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

On desktop, hovering a card highlights its path on a shared overview dome at the right of the header (optional, v1.1).

---

## 5. Screen B: Journey overview (the map and the story)

Purpose: in 10 seconds the user understands **where in the sky** they will be working, **what the story is**, and **how long** it takes.

### 5.1 The sky map

Reuse `SkyChart` in `overview` mode (the Tonight planetarium) with a new optional prop, `journey?: JourneyOverlay`, that draws:

- **Region highlight**: a soft, buffered hull around the stops (≈ 6° buffer), filled with low-alpha mint plus a **dashed outline**. The outline keeps the region visible in red mode, where tints collapse to luminance.
- **Path**: one polyline through the stops in order. Use solid 2 px lines for stops to visit and dotted lines for completed legs. Draw an arrowhead at the midpoint of each leg, since direction matters.
- **Numbered stop badges**: 28 px circles with the number inside. They are hit-targets in their own right (48 px touch area), and tapping one opens a peek card.
- **Constellation lines and names** stay on (they are what people orient by). Reduce label density inside the region to stop names plus anchor stars.
- **Moon** with an **avoidance ring** (dashed circle at the assembler's minimum separation) when the Moon is up. This is the visible proof of the "away from the Moon" rule.
- **Horizon, compass letters, and the 25° altitude circle** (the existing chart has altitude rings; the minimum-altitude ring is emphasised).
- **"Fit journey" auto-zoom**: the overview frames the region, not the whole dome. A toggle switches between **Region** and **Whole sky** so the user can see where the region sits relative to the horizon.

### 5.2 The story panel

- **The story** (≤ 60 words): the narrative thread, written as a promise. Example: *"Stars are born, live, swell and die — and their ashes build the next generation. Tonight you'll see every chapter, in order of age, without leaving one patch of the winter sky."*
- **Chapter list**: a vertical timeline. Each row shows the number badge, the role label in caps, the object name, one-line "why", scheduled time and altitude at that time:
  `③ SHATTERED STAR · M1, the Crab Nebula · what's left after a star exploded in 1054 · 21:05 · 58°`
- **Practical strip**: total time, best start, turning range in words ("you'll turn from east-south-east to south — about 40°"), the highest and lowest stop, the difficulty explanation, and what helps (*20 minutes of dark adaptation; a chair or a stable stance; red light on*).
- **Actions**: **Start journey** (primary), **Add to night** (Planner), **Read mode** (opens all cards in a scrolling, non-field layout), **Share link** (copies the hash URL).
- **Stop alternatives (v1.1)**: long-press a stop to "Swap this stop" for an assembler-provided alternative that keeps the story and region constraints.

### 5.3 Phone wireframe: Overview

```
┌──────────────────────────────────────┐
│ ‹ Journeys              [Share][⋯]   │
│ CRADLE TO GRAVE                      │
│ A star's whole life in one sweep.    │
│ ┌──────────────────────────────────┐ │
│ │        N                         │ │
│ │   ·  · TAURUS ·  ①Pleiades       │ │
│ │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐     │ │ dashed region outline
│ │  ┆  ②Hyades ─►─ ③M1        ┆     │ │ path with arrows
│ │  ┆        \               ┆     │ │
│ │  ┆   ORION ④Betelgeuse    ┆     │ │
│ │  ┆           │            ┆     │ │
│ │  ┆          ⑤M42          ┆     │ │
│ │  └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘     │ │
│ │ E ─ ─ ─ 25° ─ ─ ─ ─ ─ ─ ─ ─ ─ S  │ │ min-alt ring + horizon
│ │ (Region | Whole sky)  ☾ ring off │ │
│ └──────────────────────────────────┘ │
│ 5 stops · ~45 min · SE 35–70° high   │
│ Moderate — the Crab is faint         │
│ ┌──────────────────────────────────┐ │
│ │ THE STORY                        │ │
│ │ Stars are born, live, swell and  │ │
│ │ die — and their ashes build the  │ │
│ │ next generation. …               │ │
│ └──────────────────────────────────┘ │
│ ① TEEN CLUSTER   Pleiades   20:25 72°│
│   A family only ~100 million yrs old │
│ ┆                                    │
│ ② MIDDLE AGE     Hyades     20:35 60°│
│   Same birth story, 6× older         │
│ ┆                                    │
│ ③ SHATTERED STAR M1 Crab    20:45 58°│
│   The wreck of a star seen in 1054   │
│ ┆                                    │
│ ④ DOOMED GIANT   Betelgeuse 20:55 40°│
│ ┆                                    │
│ ⑤ NURSERY        M42        21:05 37°│
├──────────────────────────────────────┤
│ [ Add to night ]  [▶ Start journey ] │ ← sticky bottom bar
└──────────────────────────────────────┘
```

### 5.4 Desktop wireframe: Overview

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Journeys   CRADLE TO GRAVE — a star's whole life in one sweep            [Add to night][Start]│
├───────────────────────────────────────────────────────────┬────────────────────────────────────┤
│                                                           │ THE STORY                          │
│               SkyChart (overview, framed to region)       │ Stars are born, live, swell and    │
│        numbered stops ①–⑤, arrowed path, dashed region,   │ die — and their ashes build the    │
│        constellation lines, Moon + avoidance ring,        │ next generation. …                 │
│        25° ring, compass                                  │                                    │
│                                                           │ ① TEEN CLUSTER · Pleiades   20:25  │
│        (Region | Whole sky)   label size / brightness     │ ② MIDDLE AGE · Hyades       20:35  │
│        controls as today                                  │ ③ SHATTERED STAR · M1       20:45  │
│                                                           │ ④ DOOMED GIANT · Betelgeuse 20:55  │
│                                                           │ ⑤ NURSERY · M42             21:05  │
│                                                           │                                    │
│                                                           │ 5 stops · ~45 min · SE 35–70°      │
│                                                           │ Turn ESE → S (~40°) · Moderate     │
│                                                           │ Helps: 20 min dark adaptation …    │
├───────────────────────────────────────────────────────────┴────────────────────────────────────┤
│ JOURNEY AT A GLANCE   distance ladder:  Hyades 153 ly ─ Pleiades 444 ─ Betelgeuse ~550 ─       │
│                       M42 1,350 ─ M1 6,500 ly   (log scale, numbered dots)                    │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Hovering a chapter row highlights its badge on the chart, and the other way round.

---

## 6. Screen C: In-field step mode (the core)

### 6.1 Focus mode shell

**Decision:** field mode is a full-screen route (`#/journeys/:key/stop/:n`) that **hides the app header, the main nav and the session timebar**. It keeps:

- A slim top bar (≤ 44 px): `✕ Exit` · `Cradle to Grave` · `3 / 5` · red-light toggle.
- A progress rail: 5 segments, done/current/remaining. A tap jumps to that stop after a confirm.
- A **sticky bottom action bar** in the thumb zone (bottom 120 px). It holds three buttons at least 56 px tall: **Skip** (left, secondary), **I see it ✓** (centre-right, primary, the widest), and **Can't find it?** (as a text link above the bar, so it isn't a mis-tap target next to "I see it").

The screen alternates between two **phases per stop**, shown as a two-segment toggle under the top bar: **Get there** → **Look & learn**. Pressing **I see it** in Get there jumps to Look & learn. In Look & learn the primary button becomes **Next stop ›**.

### 6.2 Pre-flight sheet (once per journey, skippable with "Don't ask again")

```
│ Before you start                     │
│ [✓] Red light on          (toggle)   │
│ [✓] Keep screen awake     (toggle)   │  Screen Wake Lock API where supported
│ [ ] I've been outside 15–20 min      │  dark adaptation reminder (info only)
│ Your binoculars: 14×50 · 3.7° [edit] │
│ Facing: south-east. Orion's Belt is  │
│ the easiest landmark tonight.        │
│            [ Begin at stop 1 › ]     │
```

Wake lock uses `navigator.wakeLock.request('screen')`. Hide the toggle where it is unsupported, and release the lock on exit and on `visibilitychange`.

### 6.3 Phase 1 — "Get there" (how to move from the previous stop)

The leg mode depends on the angular distance *d* from the previous stop and the binocular true field *f* (3.7° default):

| Leg type | Rule (suggested; the assembler can tune it) | What the screen shows |
|---|---|---|
| **Same field** | d ≤ 0.8 f | "Don't move. It's in the same view — look to the lower-left of [previous]." This uses a field circle with both objects marked (`BinocularStarField`). |
| **Short sweep** | 0.8 f < d ≤ 4 f | 1–4 hop fields from the reused route planner, starting at the previous stop. The step instruction plus the pattern tip, as on Star hop today. |
| **Naked-eye jump + hop** | d > 4 f, or the previous stop was skipped/not found | Two sub-steps. **(a) Lower the binoculars.** A wide naked-eye chart (≈ 40° field, constellation lines, an arrow from the previous stop to a bright *anchor* near the target) plus a sentence: "Find Betelgeuse with your eyes: the orange star at Orion's top-left shoulder." **(b) Raise the binoculars on the anchor and hop**, which is the standard hop route from that anchor. |

**API need (for the routing implementer):** `planRoute` needs to accept a start **coordinate** (the previous stop's RA/Dec), not only a BSC `startStarId`, so that a leg can start on a DSO. Fallback until that exists: choose the brightest BSC star within 1.5 f of the previous stop as the start. If there is none, use naked-eye jump mode.

Phone layout, Get there, short sweep:

```
┌──────────────────────────────────────┐
│ ✕  Cradle to Grave       3/5   [☾]   │
│ ▰▰▰▱▱   ( •Get there• | Look & learn)│
├──────────────────────────────────────┤
│ ③ SHATTERED STAR                     │
│ M1 · the Crab Nebula                 │
│ From the Hyades: 2 binocular fields  │
│ up and left, toward ζ Tau.           │
│ ┌──────────────────────────────────┐ │
│ │                                  │ │
│ │   hop chart (SkyChart, current   │ │  ~48% of viewport height,
│ │   field circle, next-field arrow │ │  pinch zoom, orientation
│ │   matched to binocular view)     │ │  from shared prefs
│ │                                  │ │
│ └──────────────────────────────────┘ │
│ FIELD 2 OF 3 · Sky: 3.1° NE          │
│ Confirm: a bent line of 3 stars,     │
│ brightest at the top.                │
│ [‹ prev field]  ● ● ○  [next field ›]│
│          Can't find it?              │
├──────────────────────────────────────┤
│ [ Skip ]        [  I see it ✓  ]     │ ← 56 px, thumb zone
└──────────────────────────────────────┘
```

Phone layout, Get there, naked-eye jump:

```
│ ④ DOOMED GIANT · Betelgeuse          │
│ Lower your binoculars first.         │
│ ┌──────────────────────────────────┐ │
│ │  wide 40° naked-eye chart        │ │
│ │  ③ M1 ·─────────►  ★ Betelgeuse  │ │
│ │       ORION lines, Belt marked   │ │
│ └──────────────────────────────────┘ │
│ Betelgeuse is the orange star at the │
│ top-left of Orion — the brightest    │
│ thing 15° below where you were.      │
│ Got it with your eyes?  [Yes, raise ›]│
```

### 6.4 Phase 2 — "Look & learn" (the stop card in the field)

Field-mode cards show **Layer 0 and Layer 1** without scrolling. Layers 2–3 sit below the fold in collapsed sections. The card information architecture is defined in section 7.

```
┌──────────────────────────────────────┐
│ ✕  Cradle to Grave       3/5   [☾]   │
│ ▰▰▰▱▱   ( Get there | •Look & learn•)│
├──────────────────────────────────────┤
│ SHATTERED STAR                       │ role label
│ M1 · the Crab Nebula · Taurus · 58°  │
│ ┌────────────────┬─────────────────┐ │
│ │ IN YOUR 14×50  │ LONG EXPOSURE   │ │  side by side, same 3.7° scale
│ │ (simulated)    │ (survey photo)  │ │  photo dimmed to 60% in field
│ │   ·  ░  ·      │  [tap to view]  │ │  mode; tap = full brightness
│ │ 3.7° field     │ DSS2 · credit   │ │
│ └────────────────┴─────────────────┘ │
│ You'll see: a faint, small, oval     │  ← expectation line (Layer 0)
│ grey smudge. Use averted vision.     │
│ ─────────────────────────────────────│
│ WHY THIS STOP                        │  Layer 1
│ This is what's left of a star that   │
│ blew up — people saw it in 1054.     │
│ WHY FROM THE HYADES                  │
│ We just saw a calm middle-aged       │
│ family. Here is how a heavy star     │
│ ends: violently, in 1054.            │
│ ─────────────────────────────────────│
│ ▸ Understand   ▸ Wonder   ▸ Connect  │  Layer 2 (collapsed)
│ ▸ Numbers & sizes                    │  Layer 3
├──────────────────────────────────────┤
│ [ ‹ Back ]        [ Next stop › ]    │
└──────────────────────────────────────┘
```

Rules for this phase:
- **Expectation line, always above the fold.** It is seeded from `binocular-guide-extra.json` → `impression`, and must say *size relative to the field*, *brightness*, *colour or no colour*, and *technique* (averted vision, steady the binoculars, wait).
- **Simulation first, photo second.** The photo is labelled "long exposure — far more than your eye can collect". When a featured telescope photo exists, it is a third tab: "Close-up (telescope)". When binocular sketches exist (`binocular-observation-references.json`), add a link: "What other binocular observers drew ↗" (it needs a connection; label it as online).
- **Dark-adaptation guard.** In field mode, photos render at 60 % opacity with a "tap to view" overlay. In red mode they are already luminance-mapped and dimmed by the filter.
- **Logging.** **I see it** calls the existing `markObserved` for the active session, creating a session if needed (same behaviour as "I found it!" on Star hop). It also records `{journeyKey, stopId, outcome:'seen'}` for the learned scorer (section 6.6).

### 6.5 Can't find it / Skip

The **Can't find it?** bottom sheet:

```
│ Can't find M1?                       │
│ • It's faint: look slightly to the   │
│   side of where it should be.        │
│ • Rest your elbows; hold 10 seconds. │
│ • It's 58° high — not a height issue.│
│ • Moon glow: none tonight.           │
│ [Show the hop again] [Show naked-eye │
│  chart]                              │
│ [Skip — I couldn't see it]           │
```

The diagnostic lines are computed: altitude, moon glow from `MoonlightCard` data, the `BinocularAssessment` rating, and twilight.

**Skip** asks for one reason, which is optional and dismissable: *Couldn't find it · Too faint · Blocked by tree/house · Not interested*. That is a single tap, logged with `outcome:'skipped'` and the reason.

**Story continuity after a skip.** The next stop's "Why from the previous one" must not refer to an object the user didn't see. The assembler supplies, per stop *i*, a `transitionFrom[i-1]` text **and** a fallback `transitionFrom[i-2]` (skip variant). Field mode picks the variant whose source stop was last *seen*. The leg also starts from the last seen stop, or in naked-eye jump mode. When both variants are missing, the UI shows a neutral bridge: "Let's move on to the next chapter of the story."

### 6.6 Feedback signals for the learned scorer (UX side)

These are collected locally only, with no network: per stop `seen | skipped(reason) | not-reached`, time spent in each phase, and "Can't find it" opens. Per journey: completed or abandoned at stop *k*, plus an optional end-of-journey 1-tap rating (😐 / 🙂 / 🤩, rendered as text glyphs so it works in red mode). These are written to `localStorage` (`starhop-journey-feedback-v1`, capped at 500 records) and included in the existing backup/export, so a later training pipeline can use them. This must be stated in the "Where the data comes from" dialog.

### 6.7 Time drift during the journey

Field mode recalculates the remaining stops every 60 s (as live mode already ticks):
- A stop whose window will close within 10 minutes gets a chip: "Getting low — sets below 25° at 22:05". When it is not the current stop, offer **Do it next**.
- When a stop has already dropped out, show it as "Missed (too low)" on the progress rail. The next transition uses the skip variant.

### 6.8 Desktop field mode

On desktop or a tablet in landscape, field mode is a two-column layout: the chart on the left (60 %) and the card on the right. The bottom actions move to the card column's footer. Keyboard: `→` next field / next stop, `←` back, `Space` = I see it, `S` = skip, `R` = red light, `Esc` = exit (with confirm).

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ✕ Exit   CRADLE TO GRAVE   ▰▰▰▱▱ 3/5        ( Get there | •Look & learn• )       [☾ red] │
├─────────────────────────────────────────────────────┬────────────────────────────────────┤
│                                                     │ SHATTERED STAR                     │
│     hop chart / binocular simulation                │ M1 · the Crab Nebula · 58° ESE     │
│     (SkyChart, field circle, arrows)                │ [In your 14×50][Long exposure][IR] │
│                                                     │ You'll see: a faint small oval …   │
│                                                     │ WHY THIS STOP …                    │
│                                                     │ WHY FROM THE HYADES …              │
│                                                     │ ▸ Understand ▸ Wonder ▸ Connect    │
│                                                     │ ▸ Numbers & sizes                  │
│                                                     ├────────────────────────────────────┤
│                                                     │ Can't find it?  [Skip] [I see it ✓]│
└─────────────────────────────────────────────────────┴────────────────────────────────────┘
```

### 6.9 Journey summary (end)

```
│ You travelled 6,500 years of light.  │
│ ✓ Pleiades  ✓ Hyades  — M1 (skipped) │
│ ✓ Betelgeuse  ✓ M42                  │
│ ┌ HR mini-plot with your 4 stars ──┐ │
│ │ numbered dots + arrows = the arc │ │
│ └──────────────────────────────────┘ │
│ Distance ladder (log)  ①②④⑤③       │
│ How was it?   (😐) (🙂) (🤩)         │
│ [Save notes] [Try M1 another night]  │
│ [More journeys]                      │
```

"Try another night" for skipped stops adds them to Planner with a "Moon-free night" suggestion; this reuses `TargetNightSuggestions`.

---

## 7. Stop card information architecture

The card is **layered** (progressive disclosure). The same card component renders in field mode (Layers 0–1 open) and in Read mode (all open).

| Layer | Name | Content | Length budget |
|---|---|---|---|
| 0 | **Glance** | Role label (caps, ≤ 3 words) · name + common name · constellation · current altitude & direction · binocular simulation vs photo · **expectation line** | Expectation line: 25 words or fewer |
| 1 | **Why** | **Why this stop** (what makes it special *for this story*) · **Why from the previous one** (the narrative link; must name both objects or the concept they share) | 35 words or fewer each |
| 2a | **See** | How to look: technique, what to notice (colour, shape, neighbours), a comparison with something seen earlier tonight ("redder than Aldebaran"). | 50 words or fewer |
| 2b | **Understand** | What kind of object this is and which physics it shows, in plain words, with at most one new term per card, glossed inline ("a *white dwarf* — the hot, Earth-sized core left behind…"). | 90 words or fewer |
| 2c | **Wonder** | One jaw-drop fact, **always carried by a relatable scale**. | 40 words or fewer |
| 2d | **Connect** | Link it to the observer and to the journey: light-travel time ("this light left around 1480"), shared origins ("the iron in your blood was made in stars like this"), and what it will become. | 40 words or fewer |
| 3 | **Numbers & sizes** | Key-numbers table with relatable scales · HR mini-plot (stars) · size comparison · colour/temperature swatch · images (optical, infrared, featured) with credits · sources | — |

**Order rationale:** *See* comes before *Understand* because the user is at the binoculars, and Project Zero's routine starts from observation ([PZ](https://pz.harvard.edu/resources/see-think-wonder)). *Wonder* comes after *Understand* so that it lands as a payoff rather than as trivia. *Connect* closes the loop to the story and to the user (Tilden's "relate").

Mobile presentation: in field mode, the 2a–2d sections are **accordion rows** (one open at a time; the last opened is remembered). In Read mode, 2a–2d are stacked and all open. Avoid horizontal tabs for these on phones, because tabs hide the fact that there's more to read.

### 7.1 Key numbers with relatable scales

Rules:
- Never show a bare number. Each value has a **relatable line** below it, and **at most 4 numbers** sit above "All numbers".
- Use "≈" or "~" and round to 2 significant figures. Show uncertainty or a range on tap, with the source link (which the knowledge base provides).
- Apply one consistent **scale model** across the whole app, so comparisons accumulate: **"If the Sun were a 1 cm marble…"**. At that scale, Earth is a 0.1 mm grain of sand about 1.1 m away (1 AU ≈ 107.5 solar diameters).

| Quantity | Display | Relatable line pattern | Example (values to be confirmed by the knowledge base) |
|---|---|---|---|
| Size | "≈ 760 × the Sun's radius" | "If the Sun were a marble, Betelgeuse would be ~7.6 m across — about the height of a two-storey house." | Betelgeuse ≈ 764 R☉ ([Joyce et al. 2020, ApJ 902, 63](https://arxiv.org/abs/2006.09837v5)) |
| Size (tiny) | "≈ 0.008 × the Sun's radius" | "Smaller than Earth, yet as heavy as the Sun: a teaspoon would weigh tonnes." | Sirius B: 0.0081 R☉, 1.02 M☉ ([Bond et al. 2017](https://arxiv.org/pdf/1703.10625)) |
| Distance | "≈ 1,350 light-years" | "The light reaching your eye left around the year 680." (computed: current year − distance; shown as "around" plus the century when the uncertainty exceeds 10 %) | M42 414 ± 7 pc ≈ 1,350 ly ([Menten et al. 2007](https://www.aanda.org/articles/aa/abs/2007/41/aa8247-07/aa8247-07.html)) |
| Age | "≈ 100 million years" | "If the Sun's life so far were one day, the Pleiades were born 30 minutes ago." (age / 4.6 Gyr × 24 h) | Pleiades ~100–125 Myr; Hyades ~625 Myr ([Gossage et al. 2018](https://arxiv.org/pdf/1804.06441)) |
| Luminosity | "≈ 100,000 × the Sun" | "Put it where the Sun is and our sky would never be dark." (templated by order of magnitude) | from the knowledge base |
| Temperature | "≈ 3,600 K" + swatch | "Cooler than the Sun (5,800 K) — that's why it's orange." | from the knowledge base |
| Mass | "≈ 18 × the Sun" | "Heavy enough to end as a supernova (more than ~8 Suns)." | Betelgeuse 16.5–19 M☉ (Joyce 2020) |
| Event time | "exploded ~7,500 years ago; seen in 1054" | "Chinese astronomers recorded it as a 'guest star' bright enough to see in daylight." | Crab: SN 1054, ~6,500 ly, pulsar spins ~30×/s ([Chandra](https://chandra.harvard.edu/photo/2006/crab/crab_hand.html)) |

The relatable lines are **generated from templates** by unit and order of magnitude, so they scale to the whole knowledge base without hand-writing. Hand-written overrides are allowed per object. The template set is a UX deliverable, owned jointly with the knowledge-base doc.

### 7.2 Visuals (all SVG, offline, red-mode safe)

1. **HR mini-plot (stars only)**, 160×120 px:
   - x = temperature (hot on the left, log scale), y = luminosity (log scale). Draw a grey band for the main sequence, labelled regions ("giants", "white dwarfs") in small text, and a ring for the Sun labelled "Sun".
   - The current star is a large filled dot with its name. **Earlier journey stars** are small numbered dots joined by a thin arrowed line, so the story arc is drawn *on the diagram*. "Lives of stars" journeys therefore literally show the path of stellar evolution the user just walked.
   - Red-mode safety: dots differ by size, number and outline, not by hue. The temperature axis has a text "hot ← → cool" label and does not rely on a colour gradient.
   - For a cluster stop, show the cluster's **main-sequence turn-off** as a bracket, where the knowledge base supplies it, with the caption "the brightest stars still burning hydrogen — the turn-off dates the cluster". For a nebula or remnant, hide the HR plot and show the size comparison instead.
2. **Size comparison.** Nested circles (Sun, object, and the previous stellar stop) when the size ratio is below 1:300. Otherwise show the "marble" sentence plus a two-item bar ("Sun: 1 cm · Betelgeuse: 7.6 m") with a broken axis. Never mix linear and log scales without labelling them.
3. **Colour/temperature swatch.** A 20 px disc coloured by `stellarColor(temperatureFromBV(bv))` (existing `lib/stellar-appearance.ts`) **plus** a text label ("orange", "blue-white"), because the colour vanishes in red mode.
4. **Distance ladder** (overview and summary): a log axis from 10 ly to 10 Mly with the journey's stops as numbered dots. Landmarks are "Sirius 8.6 ly", "Galactic centre ~26,000 ly" and "Andromeda 2.5 Mly", from the knowledge base.
5. **Optical vs infrared toggle** (the existing 2MASS images) on nursery and dust stops, captioned "Infrared sees through dust — the hidden newborn stars appear".

### 7.3 Copy rules (for knowledge-base authors and templates)

- Second person, present tense, active verbs: "Look for…", "You're seeing…".
- Be honest about the eye: say "faint grey smudge", never "stunning nebula". The photo is labelled as a photo every time.
- Use one new term per card at most, glossed in the same sentence. Banned without a gloss: magnitude, arcminute, spectral class, main sequence, parsec.
- Keep sentences to 25 words or fewer. Layer 0–1 text should read at about a general-audience level (Flesch reading ease ≥ 60 as a guideline; the testers check it).
- Every number in Layers 2–3 has a source in the knowledge base. Cards show the sources under "Numbers & sizes → Sources".
- "Why from the previous one" must use a **relation**, chosen from: *contrast* (big → small), *sequence* (younger → older), *cause* (dying → remnant), *kinship* (same birth cloud), *proximity* ("it's right next door"), or *scale* (near → far). The assembler emits the relation type, and the UI can show it as a small chip ("CONTRAST", "NEXT CHAPTER", "CAUSE & EFFECT").

---

## 8. Example journey for design validation (Jan 15, 20:30, San Francisco)

The orchestrator and the testers can use this to check that the screens hold real content. The assembler decides actual inclusion and the knowledge base holds the numbers; the figures here are cited only to keep the wireframes honest.

**Cradle to Grave**: Pleiades → Hyades/Aldebaran → M1 → Betelgeuse → M42. The path runs roughly west-to-east, then south, inside Taurus–Orion, without backtracking.

| # | Role | Why this stop | Why from the previous one (relation) | Expectation (14×50) |
|---|---|---|---|---|
| 1 | TEEN CLUSTER | A star family only ~100–125 Myr old; its blue-white stars are still young ([Gossage 2018](https://arxiv.org/pdf/1804.06441)). | Start: the brightest, easiest cluster in the region. | A dazzling knot of 6–9 blue-white stars plus dozens of fainter ones, filling about a third of the field. |
| 2 | MIDDLE AGE | The Hyades are ~625 Myr old ([Gossage 2018](https://arxiv.org/pdf/1804.06441)): the same kind of family, ~6× older and ~153 ly away ([Gaia Collaboration 2017 distance, via Lodieu et al. 2019](https://arxiv.org/pdf/1901.07534)). | *Sequence*: same story, later chapter. Its hottest stars have already aged and left. | A large V of stars wider than your field. Orange Aldebaran sits in front of the cluster but is not part of it. |
| 3 | SHATTERED STAR | The wreck of a heavy star whose explosion was recorded in 1054. A pulsar spins ~30×/s inside ([Chandra](https://chandra.harvard.edu/photo/2006/crab/crab_hand.html)). | *Cause & effect*: this is how the heaviest stars end. | A small, faint grey oval, best with averted vision. It is the hardest stop. |
| 4 | DOOMED GIANT | A red supergiant ~764 × the Sun's radius, 16.5–19 Suns of mass, expected to explode one day ([Joyce 2020](https://arxiv.org/abs/2006.09837v5)). | *Sequence, reversed*: you just saw the aftermath, and this is what comes before it. | An obviously orange point, much warmer in colour than Rigel opposite. |
| 5 | NURSERY | Stars are being born now, ~1,350 ly away ([Menten 2007](https://www.aanda.org/articles/aa/abs/2007/41/aa8247-07/aa8247-07.html)). | *Cause & effect*: dead stars' debris enriches clouds like this one, and the cycle closes. | A grey-green fan of mist around the middle star of Orion's sword. The four Trapezium stars need more magnification. |

Story text: "Stars are born, live, swell and die — and their ashes build the next generation." Arc chips: Teen cluster → Middle age → Shattered star → Doomed giant → Nursery.

---

## 9. Red light, darkness and offline (cross-cutting requirements)

- **Red mode is the default suggestion in field mode** when the Sun is below −6° and red mode is off. The pre-flight toggle is pre-checked; the user decides.
- **No hue-only encoding** anywhere in journeys (region, HR plot, path state, difficulty, status chips). Each one pairs hue with a shape, line style, label or luminance contrast. Test by rendering with `data-night-vision="on"`.
- **Brightness budget in field mode:** the largest uniformly light area on screen may be no larger than a 48 px button. Photos are dimmed (section 6.4). Avoid white backgrounds; reuse the existing dark panel tokens.
- **Offline:** discovery, assembly, overview, field mode and cards all work without a network. Every new image goes into the build's offline manifest (`script/build.ts` → `sw.js`). External links (sketches, SIMBAD, sources) get an "online" indicator (↗) and are never required to finish a journey. The conditions strip shows "Offline ✓" from the existing offline state.
- **Performance:** journey suggestions must appear within 1.5 s on a mid-range phone. Show 3 skeleton cards within 100 ms. Run assembly in a worker, as `route-worker.ts` does, with leg routes computed lazily (per leg on entering Get there, prefetching the next leg).
- **Text size:** respect `data-text-size` (medium/large). The field-mode card must still fit Layers 0–1 above the fold at "large" on 390×844, or else move the Layer 1 "Why from previous" below the fold before shrinking type.

---

## 10. Components and state (implementation map)

| New component / module | Reuses | Notes |
|---|---|---|
| `pages/journeys.tsx` (or a `JourneysPage` component rendered from `planner.tsx` when `page==="journeys"`) | `ObservingContext`, shared settings | Keep it out of the 2,200-line `planner.tsx` as far as possible, and pass callbacks in (`markObserved`, `previewMoment`, `toggleSave`). |
| `JourneyDiscovery`, `JourneyCard`, `ConditionsLimiter`, `JourneyDomeThumb` | `ExplainedStatus`, `skyConditions`, Moon state, weather cache | The thumbnail is a tiny SVG, not a full SkyChart. |
| `JourneyOverview`, `StoryArc` | `SkyChart` (`overview`) + new `journey` overlay prop | The overlay draws the region hull, path, badges and Moon ring. |
| `JourneyFieldMode`, `LegGuide`, `NakedEyeJump` | `SkyChart`, `planRoute` (new coordinate start), `HopFieldNavigation`, `BinocularStarField` | Full-screen route; hides header/nav/timebar via a `data-focus-mode` class on `.observatory-shell`. |
| `StopCard` (layers), `ExpectationCompare`, `KeyNumbers`, `HRMiniPlot`, `SizeCompare`, `DistanceLadder` | `TargetPhoto`, `PhotoFieldPreview`, `BinocularAssessment` (compact), `stellar-appearance.ts`, binocular media JSON | `HRMiniPlot` takes `{current, trail[]}`. |
| `JourneySummary` | session export | — |
| `lib/journey-progress.ts` | Same pattern as `hop-progress.ts` (zod schema, 8 h live expiry, fingerprint = `journeyKey`) | Stores the current stop, phase, per-stop outcomes and leg field index. |
| `lib/journey-feedback.ts` | backup export | Local-only learning signals (section 6.6). |
| `lib/navigation.ts` | — | Add `"journeys"` and the sub-paths. Update the existing tests in `catalog-filter.test.ts` / `feedback-regressions.test.ts`. |

**Data contract the UI expects from the assembler and knowledge base** (names are suggestions; the other docs own the schema):

```ts
interface JourneyView {
  key: string; themeId: string; title: string; hook: string; story: string;
  stops: JourneyStopView[]; estMinutes: number; difficulty: 'easy'|'moderate'|'stretch';
  difficultyReason: string; region: { azFrom: number; azTo: number; altMin: number; altMax: number; label: string };
  bestWindow: { start: string; end: string };      // ISO
  limits: { code: string; message: string; actions: string[] }[];  // feeds ConditionsLimiter
}
interface JourneyStopView {
  targetId: string; role: string;                  // "NURSERY"
  scheduledAt: string; altAt: number; azAt: number;
  whyHere: string; transition: { fromStopIndex: number; relation: 'contrast'|'sequence'|'cause'|'kinship'|'proximity'|'scale'; text: string }[]; // [prev, skip-variant]
  expectation: string; see: string; understand: string; wonder: string; connect: string;
  numbers: { key: string; value: number; unit: string; approx: boolean; range?: [number, number]; relatable: string; sourceUrl: string }[];
  hr?: { teffK: number; lumLsun: number }; turnoff?: { teffK: number; lumLsun: number };
  images: { variant: 'optical'|'infrared'|'featured'; path: string; credit: string }[];
}
```

---

## 11. UX acceptance checklist (for the simulated-student testers)

Run at **390×844 (phone)** and **1440×900 (desktop)**, at text sizes medium and large. Use these scenarios (fixed clock, as in `script/review-round5/*.cjs`):
- **S1** San Francisco 37.77, −122.42, 2026-01-15 20:30 local, dark, Moon below the horizon.
- **S2** The same site on a night with a Moon above 80 % lit and above 30° altitude.
- **S3** Twilight (Sun between −12° and −6°).
- **S4** Offline (service worker ready, network blocked).
- **S5** The facing filter limited to S only.

Each item below is pass/fail.

**Navigation and entry**
- [ ] A1. The "Journeys" tab is visible without horizontal scrolling on 390 px, in slot 2, with `aria-current` when active.
- [ ] A2. `#/journeys`, `#/journeys/:key`, `#/journeys/:key/stop/2` and `/done` deep-link, survive reload, and work with Back/Forward.
- [ ] A3. Tonight shows a "Tonight's journey" teaser in S1, or a reason line when none fits. "Start" reaches stop 1 field mode in 4 taps or fewer from a cold load, counting the pre-flight sheet.

**Discovery**
- [ ] B1. S1 shows at least 3 journeys. Each shows a title, hook, arc chips, stop count, duration, region in words, difficulty with reason, and best window.
- [ ] B2. Theme, length and time controls change the results within 1.5 s; skeletons appear within 100 ms.
- [ ] B3. S2 shows a Moon limiter panel naming illumination, the action taken (separation or theme pausing), and at least 2 actions. No suggested stop lies inside the drawn Moon avoidance ring.
- [ ] B4. S3 shows a twilight explanation with the time darkness begins and a "Jump to" action.
- [ ] B5. The "nothing fits" state (S5 + S2) lists the binding constraints in plain words and offers at least 2 actions. There is never a bare empty list.
- [ ] B6. The same inputs give the same suggestions in the same order (determinism), and Shuffle changes them.

**Overview**
- [ ] C1. The map shows numbered stops in order, an arrowed path, a dashed region outline, constellation lines, the horizon/compass and the minimum-altitude ring. With the Moon up, it shows the Moon and its avoidance ring.
- [ ] C2. The path stays within the stated region. Visually there is no east-west or north-south zig-zag, and at most one reversal of azimuth direction. The testers record the azimuth span shown.
- [ ] C3. The story paragraph (≤ 60 words) and one role-labelled, one-line "why" per chapter are visible. A student can paraphrase the story arc after reading for 30 s.
- [ ] C4. Tapping a stop badge (or hovering on desktop) highlights its chapter row, and the other way round.

**Field mode**
- [ ] D1. Field mode hides the app header, nav and timebar. The primary action sits in the bottom 120 px, at least 56 px tall, and reachable by a right or left thumb. "I see it" and "Skip" are at least 24 px apart.
- [ ] D2. On "Look & learn" at 390×844 (medium text), the role, name, simulation-vs-photo, expectation line, "Why this stop" and "Why from [previous]" are visible **without scrolling**.
- [ ] D3. Each leg uses the right mode: same field / short sweep / naked-eye jump (section 6.3). The jump mode explicitly says "lower your binoculars" and shows a wide chart.
- [ ] D4. The expectation line mentions size relative to the field, brightness, colour or no colour, and technique. The photo is labelled as a long exposure.
- [ ] D5. "Can't find it?" shows computed diagnostics (altitude, Moon glow, twilight) and the actions "Show the hop again" and "Skip".
- [ ] D6. After a Skip, the next stop's "why from…" text does not refer to the skipped object as seen, and its leg starts from the last seen stop or a naked-eye jump.
- [ ] D7. "I see it" records an observation in the active session (visible in Planner) and advances to Look & learn or the next stop.
- [ ] D8. A reload mid-journey restores the same stop, phase and leg field. Exit + resume from the Tonight teaser works.
- [ ] D9. In S1 with the clock advanced 90 min, a stop that falls below the minimum altitude is flagged ("Getting low" / "Missed — too low").
- [ ] D10. Keyboard (desktop): ←/→, Space, S, R and Esc work as specified, and focus is visible.

**Cards and content**
- [ ] E1. Every stop has non-empty role, whyHere, transition, expectation, see, understand, wonder and connect fields within their word budgets (section 7).
- [ ] E2. Every displayed number has a relatable line and a source link. No bare numbers appear in Layers 0–2.
- [ ] E3. Each card introduces at most one undefined technical term (testers list any unexplained jargon).
- [ ] E4. Star stops show an HR mini-plot with the current star labelled, the Sun marked, and the previous stellar stops as numbered trail dots. Non-stellar stops show a size comparison instead.
- [ ] E5. Comprehension probe: after finishing S1's journey in read mode, a simulated student can answer (a) why stop 3 was chosen, (b) how stop 3 relates to stop 2, (c) one number with its relatable scale. Pass = 3/3 for at least 80 % of stops.
- [ ] E6. Tone: no superlatives that overpromise ("stunning", "spectacular") about what the eye will see. Honest about faint objects.

**Night use, accessibility and offline**
- [ ] F1. With red light on, every journey screen keeps its information: region, path state, difficulty, HR dots and colour swatches stay distinguishable by shape, label or line style (compare screenshots with the filter on and off).
- [ ] F2. In field mode, photos are dimmed by default and open at full brightness only on tap. No white panels.
- [ ] F3. The wake-lock toggle works where supported (Chrome Android) and is hidden where unsupported.
- [ ] F4. S4 (offline): suggestions generate, the overview map renders, all stop images load, and external links are marked online-only. No uncaught errors appear in the console (`pageerror` count = 0).
- [ ] F5. At text size "large", no horizontal page scroll appears at 390 px (`scrollWidth ≤ innerWidth`) on any journey screen.
- [ ] F6. All interactive elements are at least 44×44 CSS px (WCAG 2.5.5), and the primary field buttons are at least 56 px tall. All controls have accessible names. The progress rail has `aria-current="step"`.

---

## 12. Open questions and risks

1. **Nav crowding.** Eight tabs is a lot. In the medium term, merge **Clock** into Tonight or Planner and **Catalog** into Tonight search, to get back to 6. This is out of scope for v1, but flagged.
2. **Leg routing from a DSO** needs a `planRoute` start-coordinate API (section 6.3). Without it, legs start from the nearest bright star, which can feel like a detour.
3. **The binocular field varies.** The 3.7° framing of the survey photos matches the 14×50 default. For 10×50 (≈ 6.5°) and 7×50 (≈ 7°), the "In your binoculars" simulation must re-frame to the user's field. The DSS2 photo then shows a *smaller* area than the field; label this ("photo shows the central 3.7°").
4. **Content volume.** Word budgets × fields × the stop count of the knowledge base is substantial. Relatable lines must be templated (section 7.1), and only the narrative fields (whyHere, transition, wonder) need hand or offline-generated authoring.
5. **Skip variants** double the transition authoring. Accept the neutral bridge text as a fallback, and measure how often it appears.
6. **Weather offline.** Cloud data only exists if it was cached online. The UI must never imply a forecast it doesn't have.
7. **Learned scorer feedback** is local-only. Without sync, a model learns only from one user's device unless feedback is exported. Decide in the assembly doc whether exported feedback files are part of the training loop.

---

## 13. Sources

- Repo files studied: `client/src/pages/planner.tsx`, `client/src/components/{BinocularGuide,SkyChart,NightVisionFilter,HopFieldNavigation,BinocularAssessment,TargetPhoto,PhotoFieldPreview,BinocularStarField}.tsx`, `client/src/lib/{navigation,hop-progress,route-planner,binocular-assessment,stellar-appearance,observing}.ts`, `client/src/lib/{binocular-guide-extra,binocular-media,binocular-featured-images,binocular-observation-references}.json`, `client/public/data/binocular-catalog.json`, `docs/review-assets/*.png`, README.md, CLAUDE.md.
- Rods and colour in faint light; averted vision: [Astronomy.com — Am I seeing the real thing?](https://www.astronomy.com/science/am-i-seeing-the-real-thing/), [Bell Museum](https://www.bellmuseum.umn.edu/?p=14394), [Astronomy.com — space colours](https://www.astronomy.com/science/strange-universe-space-colors/).
- Red light and dark adaptation: [MWS Magazine — protecting night vision with lighting](https://www.mwsmag.com/protecting-night-vision-with-lighting/), [OptiKnow — night vision adaptation](https://www.optiknow.ca/2024/11/15/night-vision-adaptation).
- Touch targets: [Deque — WCAG 2.5.5](https://dequeuniversity.com/resources/wcag2.1/2.5.5-target-size), [CraftCMS — accessible target sizes](https://craftcms.com/blog/accessible-target-sizes), [Front-End Checklist — touch targets](https://frontendchecklist.io/rules/accessibility/touch-targets).
- Learning and interpretation frameworks: [Project Zero — See, Think, Wonder](https://pz.harvard.edu/resources/see-think-wonder), [Project Zero — See, Wonder, Connect](https://pz.harvard.edu/sites/default/files/2026-03/See%2C%20Wonder%2C%20Connect%20x2.pdf), [NPS — Meaningful Interpretation (Tilden)](https://www.nps.gov/parkhistory/online_books/eastern/meaningful_interpretation/mi2a.htm), [Museums Association — Tilden's principles](https://www.museumsassociation.org/museums-journal/opinion/2026/10/creating-meaningful-museum-experiences/).
- Example numbers: Betelgeuse — [Joyce et al. 2020, ApJ 902, 63 (arXiv:2006.09837)](https://arxiv.org/abs/2006.09837v5); Sirius B — [Bond et al. 2017 (arXiv:1703.10625)](https://arxiv.org/pdf/1703.10625); Orion Nebula distance — [Menten et al. 2007, A&A 474, 515](https://www.aanda.org/articles/aa/abs/2007/41/aa8247-07/aa8247-07.html); Pleiades/Hyades ages — [Gossage et al. 2018 (arXiv:1804.06441)](https://arxiv.org/pdf/1804.06441); Crab Nebula — [Chandra X-ray Center](https://chandra.harvard.edu/photo/2006/crab/crab_hand.html).
- Screen Wake Lock API: [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
