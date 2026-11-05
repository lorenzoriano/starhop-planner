# Sky Journeys: house voice

Status: binding for all journey text (narration bank, curated cards, edge reasons, get-there lines).
Source: the product owner's brief, `owner-feedback-r1.md` ("Target audience" and "Write like an author, not a headline
writer"). Where this file and older docs disagree, this file wins for wording; where this file and the brief disagree,
the brief wins.

## The reader

An extremely curious, scientifically savvy adult with ADHD: a lot of interest and a short attention span. They want
the real mechanism and the real numbers, not a simplified version, and they want it delivered so that it is a pleasure
to read and quick to reach the good part.

What follows from that:

- **The most interesting idea comes first, told well.** Not context, not set-up, not a teaser.
- **Savvy, not simplified.** Real physics, real numbers. Define a term in a few plain words the first time and move on.
- **Brevity comes from choosing fewer ideas, never from chopping sentences.** One good idea per box beats three facts.
- **Every stop gives one small surprise**, and every transition gives a concrete reason to go on.

## The voice

An author talking to a friend at the eyepiece. The owner named three reference voices: Carl Sagan, Neil deGrasse
Tyson and Richard Feynman. We take from them what they do on the page and on air, never their words:

- **Wonder that comes from the idea itself**, never from hype. If a sentence needs an adjective like "amazing" to be
  interesting, the idea is the wrong one.
- **Scale made personal.** Tie a distance, an age or a size to something the reader knows: a lifetime, a marble, a
  stove ring, the year a telescope was launched.
- **Concrete analogies.** Fog around a streetlight, a heated poker going from red to white, a family photograph.
- **How we know, told as a small puzzle being solved** (Feynman above all). The clever measurement or reasoning is
  often the best part: Leavitt noticing that slower Cepheids are brighter; a near star shifting as Earth circles the
  Sun; two stars of one cluster aging at different speeds because one is heavier.
- **Warmth and a touch of humour**, without condescension.
- **Connected, flowing prose.** Sentences lead into each other with rhythm and a natural voice. Short is fine;
  staccato is not.

Original prose only: never quote or imitate a famous line of Sagan, Tyson or Feynman. Write in their spirit, not as
pastiche.

### What we never write

- Headlines and colon formulas: "Orion: Spot the Difference", "Same Sky, Different Stories: Canis Major".
- Punchy fragments and stacks of short declarative facts: "Old news from space. Read it like a calendar."
- Teasers and clickbait: "the next stop will match it in one way and break with it in another", "You won't believe…",
  "Find out when."
- Exclamation marks.
- Meta-talk about the tour instead of the sky: "it raises the question we'll answer", "One thing first:",
  "adds the next piece of the story", "This is the high point of the journey", "{name} answers tonight's question.",
  "Next question:", "Change of theme:".
- Stats lines in prose: "In about 40 minutes you visit 5 stops around Perseus." The UI shows the stop count and time.
- Repetition across boxes: no sentence appears twice on one card or one journey. The driving question is shown by the
  UI (overview, and the first card's question box when the object has no `card.question`), so no why-here line repeats
  it; the answer to the driving question appears once, in `Journey.payoff`.

### Numbers

Never introduce a number that is not backed by a fact with a `sourceId` on that object (rendered through a
placeholder, so it is traced), or by a cited constant in the bank's `citations`, or already present in the text being
rewritten. Glossary definitions may use definitional numbers (unit conversions, the magnitude scale). Say "about" for
measured values, and give each number once.

## The card

Each stop is a card of distinct boxes, read top to bottom. The UI is built to this order.

| Box | What it does | Budget |
|---|---|---|
| 1. `question` | A genuine, curious question this stop answers, phrased the way a person would wonder it. Not a teaser. | ≤ 16 words |
| 2. `getThere` | Generated: anchor, constellation, moves in fields of the observer's binoculars. | unchanged |
| 3. `whyHere` | One short flowing paragraph that ties this stop to the journey's thread. The engine's transition line from the previous stop is shown just before it, so do not repeat it. | 1–2 sentences |
| 4. `see` | What binoculars honestly show and how to find it, with the constellation and a starting star. | 2–4 sentences |
| 5. `understand` | "The story": the mechanism and how we know it, building toward the answer without giving it away flatly. | 3–5 sentences |
| 6. `answer` | Resolves the question gracefully, ideally with a final turn of wonder. | 1–3 sentences |
| 7. `wonder` | Optional: one sentence that adds something new (a scale, a consequence), or empty if it would only repeat. | 1 sentence |
| `connect` | One sentence linking to the next idea, or empty. | 1 sentence |
| `glance` | What you will see at a glance. | 1 sentence |

Word budget for `question` + `whyHere` + `see` + `understand` + `answer`: **130–200 words for a showpiece card,
90–140 for a supporting card.** No sentence may repeat across boxes.

### Worked example (δ Cephei; match the register, don't copy it)

- **question:** How did a flickering star in Cepheus end up measuring the universe?
- **whyHere:** Tonight's stars look alike at first, yet lead wildly different lives. We begin with δ Cephei, a star that
  seems modest until you learn what its heartbeat can do.
- **see:** δ Cephei marks the south-east corner of the little house of Cepheus. Hold your binoculars steady and a
  fainter blue-white companion appears beside it. Come back over a few nights and compare it with ζ and ε Cephei
  nearby: it climbs quickly to match the brighter one, then sinks slowly toward the fainter, like a long breath.
- **understand:** δ Cephei is a yellow supergiant, a heavy star swollen late in life, and its outer layers rise and
  fall every 5.37 days. In 1912 Henrietta Leavitt, poring over thousands of similar stars on glass photographic plates,
  noticed that the slower a Cepheid beats, the more light it truly pours out. That makes every Cepheid a lamp of known
  wattage: time the beat and you know its real power.
- **answer:** Compare that real power with how faint the star looks, and the difference tells you how far its light has
  travelled. About a decade later Edwin Hubble caught the same heartbeat in a star inside the Andromeda 'nebula', and
  the universe grew enormously overnight.

Why it works: the question is one a person would ask; the why-here ties the star to the night's thread without
repeating the question; the see box gives a place, a method and an image; the story builds the puzzle (Leavitt's
plates) and stops one step short; the answer closes it and ends on scale.

### House rules from the editorial pass (round 2)

One author wrote every card, so these hold across all twelve curated batches.

- **Answers open with a full clause.** Never "Yes:", "No:", or a fragment and a colon ("Distance:", "Like M22:",
  "By sheer size:"). Resolve the question in a sentence: "Sirius is a fairly ordinary star that simply lives next door,
  so close that its light reaches you in under nine years." A colon after a real clause is fine ("It strips itself
  bare, and …", "These two mark the limit: …").
- **No tagline closers.** Drop the aphorism stuck on the end of a box ("Distance hides power.", "One point, two
  suns.", "Same birthday, different clocks."). Fold the turn into the last sentence instead.
- **The answer adds, it does not restate.** If the story already says "its brightest members are now orange giants",
  the answer must not say it again; give the consequence or the number the story held back.
- **One device per neighborhood.** Cards that can share a journey (same constellation or its neighbors) must not
  reuse the same question, the same analogy or the same sentence frame. In particular: the "if the Sun's life were
  one day" clock, the "light fades with the square of distance" sentence, and "N times farther than X".
- **Light-travel wonders carry an anchor.** "Its light left around 1945." is not a wonder. Tie the date to
  something human ("as the Second World War was ending", "while Chaucer was writing The Canterbury Tales") or
  write a different wonder. Neighboring cards use different anchors.
- **Wonder and connect never repeat the card.** A wonder that restates the answer's number or the why-here's idea
  gets replaced.
- **Spelling and style.** American spelling everywhere readers look, including `deeper`, photo captions and
  number labels: color, gray, center, disk, catalog, modeled, analyzed, toward, neighbor, traveled. Proper names
  of sources keep their own spelling ("General Catalogue of Variable Stars"). Compass points are hyphenated to match
  the get-there text from `region.ts`: north-east, south-south-west.
- **Numbers from `deeper`.** A number taken from the card's own `deeper` or `historyHook` text counts as sourced (both
  cite their papers), as long as it keeps the meaning it has there. Simple arithmetic on sourced numbers (ratios,
  inverse squares, a light-travel year) is allowed; state it as approximate.

## The theme lens (owner feedback r2)

> "Cards should be kind of personalized to the journey." A card must say why the object is in *this* journey, and the
> cards together must read as one story, not as objects sorted by a number.

Every active theme has a lens file, `script/journeys/curated/lenses/<archetype>.json` (format in
`05-journey-engine-design.md` §5.4a). The card's general text (`see`, `understand`, `wonder`, numbers) is shared by
every theme; the lens writes the parts that depend on the story. On a lens stop the card reads:

| Shown | From | How to write it |
|---|---|---|
| chip | `lens.beat` | A few words naming the object's role in this story ("Ruler: a cluster's shared parallax", "Orange: cooler than the Sun"). Chips of one theme share a frame, so the beat is legible at a glance. |
| question | `lens.question` | The theme's question about this object, ≤ 16 words, ends with "?". A9 asks about the split, A2 about the color, A3 about the ruler. Hedge it when the science is uncertain. |
| transition, then why | lens `transitions`, then `lens.why` | The transition says how this stop advances the thread from the last one, in theme terms. The why names the object's role in the thread in 1–2 flowing sentences and does not give the answer away. |
| what to look at | `lens.look ?? card.see` | What to look at for this theme, true in the selected binoculars: the color in a color journey, the split in a doubles journey. Never promise a split, a color or a nebula the observer cannot see. |
| story | `lens.story` | 2–4 sentences: the mechanism, or how we know, **for this theme** (A2: why this color means this temperature; A3: how this rung's ruler works and why it needs the rung below; A9: what proves the pair is bound). It builds toward the answer without giving it away. When the lens has no story, the shared `card.understand` fills the box instead. |
| More about {name} | `card.understand`, `card.wonder` | Collapsed. On a lens stop the shared story (when `lens.story` replaced it) and the shared wonder sit here, so an off-theme fact never interrupts the thread. |
| answer | `lens.answer` | 1–3 sentences that answer the question **and move the thread forward** toward the next beat. |
| payoff (last stop, done screen) | `payoff.<template>.end<lastStep>`, else `payoff.<template>` | No label ("Where it lands" is gone); one sentence longer than before, carrying the lesson to the next night. Beat-aware: the variant for the beat the journey ends on is tried first. |

Rules for lens text:

- **The storyline is the thread.** Write the `storyline` paragraph first, then the beats. Each beat adds an idea that
  needs the one before; a beat that only says "bigger" or "farther" is a sort, not a step.
- **True whatever the night reaches.** Transitions are keyed by beats (`pairs["2>3"]`, `arrive["4"]`), not by objects,
  so a line must be true for any two stops on those beats and in either order for same-beat pairs ("3>3"). Do not
  name a specific star in a pair line, and do not promise what the next stop will be or how far the night will go.
  Story and payoff lines must hold for whichever beats the night covers.
- **No living star "has reached the end"**; no "cool" for a blue-white supergiant; hedge debated memberships and
  masses ("very likely", "about").
- **Each number once per stop.** A lens why or answer must not repeat a number or phrase from the card's own story or
  wonder; the A/B test fails on any repeated sentence of six or more words.
- **Answers open with a full clause**, as on the cards: no "About 4,000 K:" or "Partners:" openers.
- **`lens.story` rules.** Write it for the theme, not for the object: the same star has a different story in a
  thermometer night (why its tint is a temperature) and in a doubles night (what binds the pair). Keep it to 2–4
  flowing sentences, explain a mechanism or a measurement, and do not repeat the lens why, look or answer, or the
  card's own `understand` (which now sits under "More about {name}"). Define a term the first time it appears on the
  card; a story read before the answer must not lean on a word that only the answer explains. Prefer leaving `story`
  out to writing a generic one: without it the shared `card.understand` fills the box.
- **Beat-aware journey lines.** `story.<template>.end<N>` and `payoff.<template>.end<N>` are tried before the generic
  keys, where N is the beat the journey ends on. They may name what that ending shows; they must never promise a beat
  the journey did not visit. Story lines never repeat the hook's wording (the hook is shown just above them).
  `<family>.<template>.end<N>.no<S>` (title, story, payoff) is tried first on a night that ended on beat N without
  visiting beat S: A9 keeps its partner-promising titles for nights with a proven-partner stop (`end5.no4` gets
  titles and payoffs that promise none).
- **`minMagnification`** keeps a lens stop to binoculars of at least that power when its look is written for it but
  the pair data alone would allow less (Mintaka's faint companion at 10×).
- **`rank`** orders stops that share a beat (ascending). Set it to the theme's own quantity: age for A5, distance for
  A3 and A11, temperature for A2.
- **Sentence length.** No sentence over 220 characters after `{hook}` and `{name}` are filled in (the narrator's
  validator rejects it); split long payoff sentences at the colon.
- **Retired themes.** A4 (time machine) and A10 (stars that change) are no longer journeys. Light-travel time and
  variability stay as card lines where they help; do not write lenses for them.

## Journey-level text (the narration bank)

The bank is `client/public/data/journeys/src/narration.json`; comparison lines the bank lacks come from
`script/journeys/kb/narration-extra.json`. The narrator is `client/src/lib/journeys/narrate.ts`.

- **Titles** (`title.<template>`): chapter titles an author would choose, evocative but plain, never clickbait. Every
  title names its `{region}`, and the five variants of each template use different shapes (region at the end, a
  possessive, region in the middle, region first, an occasional question or colon). No shape may cover more than a
  quarter of titles, and colons stay rare. "Perseus' Ladder into the Dark", "Look-Alikes of Canis Major",
  "How Far Back Cygnus Goes". Names ending in s take a bare apostrophe (`narrate.ts` does this).
- **Driving questions** (`question.<template>`): genuine and curious, ≤ 16 words. "When you see one star, how many are
  really there?"
- **Hooks** (`hook.<template>`, ≤ 90 characters): the lede on the overview. One flowing sentence with the most
  interesting idea: "In the sky red means cool and blue means hot, the reverse of every bathroom tap."
- **Story** (`story.<template>`): 2–3 flowing sentences that make the reader want to go. Prose only, no stop count, no
  minutes, no digits, and never the hook again. `{hook}` is the first stop, `{name}` the payoff stop; each template has
  at least one variant without `{name}` or `{region}` (after an archetype switch `{name}` stays empty).
- **First stop** (`why.hook.<template>`): ties the first stop to the thread in 1–2 sentences. Never repeats the driving
  question. "To measure the depth of the sky you start close to home, and Algol is the first rung, near enough that its
  light takes about 90 years to reach you."
- **Payoff stop** (`why.payoff.<template>`): a short thread line ("The scale tops out at Meissa, a blue giant."),
  followed by the curated card line. It never states the answer.
- **Payoff** (`payoff.<template>`): the narrated answer to the driving question, shown once on the final card and the
  done screen. It must answer every wording of the question in the bank, so it never opens with "Yes" or "No" and never
  asks again. End on a turn of wonder.
- **Transitions** (`<EDGE_TYPE>[.<subtype>|.<fact>]`): one connected sentence that carries the reader from the last
  stop to this one with the concrete link, and the sourced numbers when there are some. When there is no number, name
  the kinds ("Where Aldebaran is an orange giant, …"). Never "compare and contrast" without saying what.
- **Skip lines** (`skip.*`): one sentence that bridges around a missed stop, plus the concept's bridge sentence when
  the missed idea matters to the theme.
- **Switch lines** (`switch.<template>`): one sentence that makes the turn feel natural, then `{themeQuestion}`.
- **Comparison lines** (`compare.*`): start from the value and carry on in one flowing sentence: "About 3,600 K, and
  like a stove ring glowing dull red, a cooler surface shines redder."

## Before and after (current shipped text, `script/journeys/train/ab-round1.json`)

**1. Titles (ab1-01, ab1-12)**
- Before: "Orion: Spot the Difference" / "Same Sky, Different Stories: Canis Major"
- After: "Orion's Unlikely Twins" / "Look-Alikes of Canis Major"

**2. Story overview (ab1-05 right, Boötes)**
- Before: "Old news from space: each stop's light is older than the last. In about 40 minutes you visit 5 stops around
  Boötes, from Arcturus to the Great Hercules Globular Cluster. R Coronae Borealis is the one challenge stop: worth a
  patient minute, and fine to skip if it won't show."
- After: "Every distance in the sky is also a stretch of time. Starting with Arcturus, you move to ever older light, and
  the night becomes a walk back through history."

**3. First stop (ab1-01 left, Aldebaran)**
- Before: "Why do stars that look alike lead such different lives? Aldebaran is the first look-alike: easy to find, and
  less simple than it looks."
- After: "Tonight's stars look alike at first and lead very different lives, so take in the color and brightness of
  Aldebaran, because both can mislead."

**4. The payoff stop and the answer (ab1-01 right, Andromeda Galaxy)**
- Before (why-here, and the same text again as the journey's payoff): "Which of these is closest, and how do we know?
  From Algol next door out to the Andromeda Galaxy: astronomers rank them by measuring, with parallax (the small shift
  of a near star as Earth circles the Sun) for the near rungs and cleverer yardsticks beyond."
- After, why-here: "The Andromeda Galaxy is the top of the ladder. A whole other galaxy, and the farthest thing most
  people ever see with their own eyes."
- After, the answer (once, on the final card): "Algol was the nearest and the Andromeda Galaxy the farthest, its light
  taking about 2.5 million years to reach you. Brightness alone would never have told you that order, but measurement
  did."

**5. Transitions (ab1-11 left, Gacrux → Eta Carinae; ab1-01 right, Stock 2 → ρ Cassiopeiae)**
- Before: "Gacrux showed one chapter of a star's life, and Eta Carinae is the next one." / "ρ Cassiopeiae sits about 8
  times farther than Stock 2 (Muscleman Cluster), about 9,170 light-years from us."
- After: "If Gacrux is one chapter of a star's life, Eta Carinae is the page you turn to after it." / "ρ Cassiopeiae
  sits about 9,170 light-years away, about 8 times farther than Stock 2 (Muscleman Cluster), so its light has a longer
  road behind it."

**6. Hook and payoff (ab1-03 right, Cepheus; ab1-01 left, Orion)**
- Before: "Compare, estimate, discover: one night as a variable-star observer." / "Each pair tonight shared a look and
  differed in one deep way, and Rigel showed the biggest gap."
- After: "Spend a night as a variable-star observer, comparing stars that refuse to keep still." / "What your eye sees,
  color and brightness, is only the surface; underneath, each look-alike pair differed in temperature, age, distance
  or mass, and that difference shaped their lives."

## Standing rules (from round 1, still binding)

1. **Define every technical term at first use, in plain words**: Cepheid, spectral class, supergiant, open cluster,
   light-year, parallax, eclipsing binary, planetary nebula. Inline the first time a journey uses it ("a Cepheid, a star
   that swells and shrinks on a strict rhythm"); the app also makes every term in
   `client/public/data/journeys/glossary.json` tappable through `findGlossaryTerms`.
2. **No raw catalog codes as a description.** Write "white giant + orange giant", never "A7 III (θ²) + G9 III (θ¹)"
   (`plainClass` in `client/src/lib/journeys/plain-language.ts`). The class can stay in an expandable detail.
3. **Get-there text is for a person holding binoculars**: name the anchor, how to recognise it and its constellation,
   its height and direction, and moves in fields of the observer's own binoculars with the field size and the degrees,
   each number once.
4. **Names read naturally**: "the Andromeda Galaxy", "the Garnet Star", "the Hyades", but "Algol", "Stock 2"
   (`nameInSentence`).
5. **One challenge stop is a plus.** Say so once on the card ("It is tonight's challenge, so give it a patient minute
   and skip it without guilt if it stays hidden"), not in the overview.

## Where each rule lives in code

| Rule | Code / data |
|---|---|
| no repeated question; thread lines for the first and payoff stops | `narrate.ts` (`why.hook.<template>`, `why.payoff.<template>`) |
| the answer once | `narrate.ts` `payoff` → `Journey.payoff` (`applyNarration`) |
| story overview without stats | `narrate.ts` `storyLine`, bank `story.<template>` |
| curated why-here over generic lines | `narrate.ts` (`card:whyHere`) |
| kinds in transitions | `narrate.ts` `kindSlots` + bank placeholders `{prevKind}`, `{nextKind}`, `{sharedKind}` |
| at most one bridge, on-theme only, no lead-in | `narrate.ts` `MAX_BRIDGES`, `bridge.prereq` = `{bridge}` |
| plain descriptions, glossary | `plain-language.ts`, `glossary.json` |
| get-there anchors and field sizes | `getthere.ts` `ANCHOR_HINTS`, `spanPhrase`, bank `direction.*` |
| banned phrases, no repeated sentence, title shapes | `client/src/lib/journeys/__tests__/narrate.voice.test.ts` (`BANNED`, `titlePattern`), `story-data.test.ts` |
| theme lens: chip, question, why, look, answer; transitions per beat; storyline and beats | `script/journeys/curated/lenses/<archetype>.json`, validated by `script/journeys/kb/lenses.ts`; resolved by `client/src/lib/journeys/stop-card.ts` |
| lens text in an owner round: lens on every stop, no repeated sentence in a stop | `client/src/lib/journeys/__tests__/ab-pairs.test.ts` |
