# Owner feedback, round 1 (2026-11-02)

The product owner ranked calibration sets cal-01..03 (`script/journeys/train/calibration-slates.json`) and left notes.
This file is the binding brief for the rework. Quotes are verbatim.

## Target audience (owner, 2026-11-02; overrides earlier persona docs)

"Your target audience should be an extremely curious, scientifically savvy ADHD adult: a person that has a lot of
interest but a short attention span."

What this means for every piece of work:
- **Hook first.** The first line of every card, stop and journey is the most interesting thing, not context. The
  question must be one this reader actually wants answered.
- **Savvy, not simplified.** Real physics, real numbers, real mechanisms. Don't talk down, don't pad. Define a term in
  a few words and move on (or make it tappable), never a lecture.
- **Short chunks, fast payoff.** Each box is 1–3 sentences; the answer arrives quickly. Depth is opt-in ("more"),
  never in the way.
- **Novelty and momentum.** Every stop delivers a surprise or a "wait, what?"; transitions create a pull to the next
  stop. Shorter journeys and quick wins beat long careful ones; visible progress.
- **Scannable and visual.** Distinct boxes, icons, images, the map: the eye should find the next thing without reading
  everything.

The older personas (Maya, Dan and Leo, Rita, Sam) become secondary; judge panels score against this reader first.

### Write like an author, not a headline writer (owner, 2026-11-02)

"Make sure not to write text as if it were headlines in a newspaper. I want the text to be flowing. I want the text to
be written by an author, by a writer, not by a journalist or clickbaity thing. It has to be pleasant to read, not just
shooting sentences for the sake of information."

- "Hook first" means the most interesting idea comes first, told well. It does not mean punchy fragments, teasers,
  exclamation marks, "You won't believe…", or a stack of short declarative facts.
- Write connected prose: sentences that lead into each other, with rhythm and a natural voice. Short is fine;
  staccato is not.
- **Reference voices (owner): Carl Sagan, Neil deGrasse Tyson and Richard Feynman.** From Feynman especially: explain
  the mechanism from first principles in plain words, show *how we know* (the clever reasoning, the measurement)
  rather than just stating the fact, and enjoy the puzzle out loud. Take from all three what they do on the page and on
  air: wonder grounded in real physics; a sense of scale made personal ("the iron in your blood was made in a star
  like this"); vivid, concrete analogies; warmth and humour without condescension; enthusiasm that comes from the
  idea itself, never from hype. Original prose only: never quote or imitate their famous lines; write in that
  spirit, not as pastiche.
- Each box is a small paragraph that reads aloud pleasantly, not a list of facts with full stops between them.
- Questions are genuine and curious in tone, not clickbait. Answers resolve them gracefully.
- Keep it brief by choosing fewer ideas, not by chopping sentences.

## Rankings vs the engine's heuristic

| set | owner 1st | owner 4th | heuristic top (#0) placed by owner |
|---|---|---|---|
| cal-01 | A How Far (Perseus) | D Cradle to Grave (Taurus) | 1st (agreement) |
| cal-02 | B Seeing Double (Boötes) | D Contrasts (Ursa Major) | **4th** |
| cal-03 | A Stars That Change (Cepheus) | B Seeing Double (Cygnus) | **3rd** (C Contrasts) |

Reading: the owner prefers journeys with a clear progression and a payoff (distance ladder, variable stars, doubles
with a good story). Contrasts (A6) journeys were the heuristic's favourites and ranked low twice. The heuristic
is mis-calibrated; don't overfit 3 sets, but A6 should stop dominating and story progression should count more.

## Text and voice

- "Every time you say 'It raises the question we'll answer', I think you should just say the question … the card can
  start with a question, and then at the end of the card you give the answer." Also: "He keeps saying things, and I
  think it's getting old very quickly." → **No boilerplate filler.** Each card opens with the actual question
  (`card.question`) and ends with its answer (`card.answer`). Transitions say the concrete thing, never meta-talk.
- Liked, keep this voice: "beautiful and at the heart of the story"; "but they are strangers: Merak belongs to the
  Dipper's family, while Dubhe is a passer-by half again as far away." → concrete, vivid, a small surprise per stop.
- "We should be compressing the text a bit. Not by a lot, but just make it flow better. Right now, it's too broken up."
- "'θ¹ / θ² Tauri · A7 III (θ²) + G9 III (θ¹)' This information is not telling me anything." → never show raw
  spectral classes or catalog jargon as the description line. Say "white giant + orange giant" (classes can stay in
  an expandable detail).
- "'rare check on a Cepheid.' Did you define Cepheid?" → every technical term is defined at first use, in plain words
  (inline, and tappable in the app via a glossary).
- "'Find Arcturus by eye, about 45° up in the east' what about saying which constellation it belongs to?" → Get-there
  text names the constellation and a recognisable anchor ("Arcturus, the bright orange star at the end of the
  Big Dipper's handle arc, in Boötes").

## Story logic

- cal-03 D (distance ladder): "it should have been of increasing distances, not having the last one be closer. Maybe
  shorter jumps, because four of them are within the same range, and then you put that cluster that is dozens or
  thousands of light years away." → ladders are strictly monotonic, with even-ish steps (no flat run then a giant leap).
- "I like the idea of having a challenge in the set." → one challenge stop is a plus, not a flaw.
- cal-02: "C and D are pretty much the same" → never offer two near-identical journeys (same theme + region, or same
  title) in one result.

## Visuals and UI

- "We need images for the other items." / "There is no image of γ Cassiopeiae." → every stop has a picture.
- "These cards … should really be cards, as in boxes, something colorful, because otherwise right now everything feels
  like a lot of text." → Get there / Why here / What you'll see / Understand become distinct visual boxes.
- "It will be great to see the hops … the path is really small, and I can't zoom in or move around." → a large,
  zoomable, pannable route map with the hops.
- "I'd like to click on an image and have an enlarged, high-resolution version." → image lightbox.
- "Everything should be based on the binocular one has selected." → the app already plans with the selected binocular
  profile (`journey-view.ts` passes `profile.fov`); keep it that way and say the field size in get-there text.

## Process

The owner won't rank 20 sets of 4. Next rounds are **A/B pairs**: two complete journeys for the same night; the owner
answers Left / Right / Equal / Neither, with an optional note.
