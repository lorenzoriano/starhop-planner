/**
 * The stop card as the reader sees it, resolved from the stop (its theme lens and narrated texts), the object's
 * shared card and the journey (owner feedback r2: "Cards should be kind of personalized to the journey").
 *
 * Box order and sources (docs/sky-journeys/owner-feedback-r2.md, the ThemeLens contract in types.ts):
 *   beat        lens.beat chip (the object's role in THIS story), else the slot label (stop.role)
 *   question    lens.question, else card.question, else (first stop) the journey's driving question
 *   transition  stop.transitionText (shown just before why)
 *   why         stop.whyHereText (narrated; for a lens stop it is lens.why), else lens.why, else card.whyHere
 *   look        lens.look (what to look at for this theme), else card.see
 *   story       lens.story (the mechanism / how-we-know for THIS theme), else null
 *   understand  card.understand (the object's shared story: the Story box when there is no lens.story, else under
 *               the collapsed "More about {name}")
 *   answer      lens.answer, else card.answer
 *   wonder      card.wonder, empty when it would repeat another box; after the answer on a stop without a lens, under
 *               "More about {name}" (after `understand`) on a lens stop (`codaUnderMore`): the card ends on its
 *               answer, and a wonder that refers to the shared story sits right after it
 *   payoff      Journey.payoff on the journey's payoff stop (shown without any label sentence)
 * A UI or an export page renders these fields as they are; no other logic is needed.
 */
import type { Journey, JourneyStop, KbObject } from './types';

export interface ResolvedStopCard {
  beat: string;
  question: string | null;
  transition: string | null;
  why: string;
  look: string;
  /** The object's general "what you'll see" (kept for a details view when `look` is the theme's own line). */
  see: string;
  /** The lens's own story for this theme (Story box), or null when the stop has no lens story. */
  story: string | null;
  /** The object's shared story (card.understand); under "More about {name}" when `story` is set. */
  understand: string;
  answer: string | null;
  wonder: string;
  /** The journey's payoff, on its payoff stop only. */
  payoff: string | null;
  /** True when the stop is told through a theme lens. */
  lensed: boolean;
  /** The wonder (and card.connect) go under "More about {name}" instead of after the answer (lens stops). */
  codaUnderMore: boolean;
}

const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
/** `text` says nothing new next to `others` (empty, or equal to / contained in one of them). */
function repeats(text: string | undefined, others: readonly (string | null | undefined)[]): boolean {
  const t = norm(text ?? '');
  if (!t) return true;
  return others.some((o) => { const n = norm(o ?? ''); return !!n && (n === t || n.includes(t)); });
}

export function resolveStopCard(journey: Pick<Journey, 'drivingQuestion' | 'payoff' | 'stops'>, stop: JourneyStop, o: KbObject): ResolvedStopCard {
  const lens = stop.lens;
  const card = o.card;
  const question = lens?.question ?? card.question ?? (stop.index === 0 ? journey.drivingQuestion : null);
  const why = stop.whyHereText ?? lens?.why ?? card.whyHere;
  const look = lens?.look ?? card.see;
  const answer = lens?.answer ?? card.answer ?? null;
  const wonder = repeats(card.wonder, [look, card.see, card.understand, answer, why]) ? '' : card.wonder;
  const lastPayoff = journey.stops.map((s) => s.arc).lastIndexOf('payoff');
  const payoff = journey.payoff && stop.index === lastPayoff && !repeats(journey.payoff, [answer, why]) ? journey.payoff : null;
  return {
    beat: lens?.beat ?? stop.role,
    question,
    transition: stop.transitionText,
    why,
    look,
    see: card.see,
    story: lens?.story?.trim() ? lens.story : null,
    understand: card.understand,
    answer,
    wonder,
    payoff,
    lensed: !!lens,
    codaUnderMore: !!lens,
  };
}
