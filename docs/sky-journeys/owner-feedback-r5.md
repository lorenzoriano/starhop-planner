# Owner feedback, round 5 (A/B round 4, 2026-11-04)

Answers: `script/journeys/train/ab-round4-answers.json` (2 of 2 pairs answered). This brief adds to
`owner-feedback-r1.md` to `-r4.md`, which stay binding. Quotes are verbatim.

## Results

| pair | left | right | owner |
|---|---|---|---|
| 01 | A9 doubles, rebuilt (Lyra) | A1 cradle to grave (Cygnus) | equal: "They are both great." |
| 02 | A3 how far (Cassiopeia) | A9 doubles, rebuilt (Taurus, no orbiting pair in reach) | equal: "Again, both great." |

The rebuilt A9 (a verdict on every card, the three-way rule, Sheliak dropped) now ties the strongest theme. Rules 4–6
from round 4 are confirmed.

## Decisions on the open issues

> "I think it's fine that cards or journeys depend on the current conditions. [...] The journeys should depend on the
> current conditions. If a double journey is not available in January with 7:35, then we can just not have it."

7. **Journeys follow tonight's conditions.** A theme with no honest journey for this month, altitude or optic is simply
   not offered. Don't add objects to fill a gap.

> "if there are classic routes that work, then we should try to use them because they exist for a good reason. We
> should revert to algorithmic calculations whenever a classic, well-established, good route does not exist."

8. **Classic routes first.** A classic star-hop (`client/public/data/known-routes.json`) that is feasible tonight and
   followable in the user's optics is listed first; the algorithmic planner is the fallback.

> "Don't add the sources, don't add citations. It would just add clutter."

9. **No citations on cards.** Figures stay as prose; sources live in the KB, not on the card.

> "If the end result is worth it, then let's do it." (red-light mode)

> "Just remove the broken stuff. Let's make the repository and the stuff tidy." (old journey bookmarks)

> "You can delete them." (tests pinned to old KB versions)
