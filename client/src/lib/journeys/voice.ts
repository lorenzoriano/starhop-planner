/**
 * House-voice rules that code can check (docs/sky-journeys/voice.md "What we never write"; owner feedback r1/r2).
 * Shared by the KB build (theme lenses), the narration tests and the A/B export test, so every text is held to one
 * standard.
 */

/** Meta-talk, filler, teasers, stats lines and exclamation marks the owner banned. */
export const BANNED = /raises the question|we['’]ll answer|one thing first|before we go on|quick background|short reminder before|next piece of the story|high point of the journey|one more example|same species|\blet['’]s\b|here the story turns|takes the story one step|next idea you need|the opening stop|compare and contrast|answers tonight|match it in one way|break with it in another|won['’]t believe|you visit \d+ stops|in about \d+ minutes|next question:|change of theme|stay tuned|spoiler|where it lands|!/i;

/** Most words a card question may have (voice.md, the card table). */
export const QUESTION_MAX_WORDS = 16;

/** Word count as the voice rules count it (whitespace-separated tokens). */
export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Problems of a card question: at most QUESTION_MAX_WORDS words and ending with "?". */
export function questionProblems(q: string): string[] {
  const out: string[] = [];
  if (!q.trim()) return ['empty question'];
  if (wordCount(q) > QUESTION_MAX_WORDS) out.push(`question has ${wordCount(q)} words (max ${QUESTION_MAX_WORDS})`);
  if (!/\?["”’)]?$/.test(q.trim())) out.push('question does not end with "?"');
  return out;
}

/** Abbreviations whose period does not end a sentence. */
const ABBREV = /\b(?:e\.g|i\.e|vs|approx|ca|cf|etc|Dr|St|Mt|No|Fig|al)\.$/i;

/** Most characters a sentence may have (the narrator's validator, doc 05 §8; voice.md "Sentence length"). */
export const SENTENCE_MAX_CHARS = 220;

/**
 * The sentences of a prose text: a period, "?", "!" or "…" (with any closing quote or bracket) followed by a space or
 * the end. Decimals ("3.5"), common abbreviations ("e.g.", "vs.", "St."), initials ("M. 42", "E. E. Barnard") and a
 * period followed by a lower-case word ("approx. a") do not end a sentence, unless that word is a lower-case Bayer
 * letter ("h Persei"). A Greek letter or a single capital that
 * closes a clause ("paler ζ¹.", "Cassiopeia's W.", "40 Eridani B.") does.
 */
export function splitSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const out: string[] = [];
  let start = 0;
  const re = /[.?!…]+["”’)\]]*(?=\s|$)/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const before = t.slice(0, m.index + 1);
    if (ABBREV.test(before)) continue;
    const end = m.index + m[0].length;
    const after = t.slice(end);
    // An initial: a single capital before a number or another initial, or after one ("M. 42", "E. E. Barnard").
    if (m[0] === '.' && /(?:^|[\s(])[A-Z]\.$/.test(before) && (/^\s+(?:\d|[A-Z]\.)/.test(after) || /\b[A-Z]\.\s[A-Z]\.$/.test(before))) continue;
    // A period before a lower-case word is an abbreviation, not the end of a sentence ("approx. a", "H.E.S.S. observatory").
    // A lower-case Bayer letter before a constellation name ("h Persei", "o Ceti") still starts a new sentence.
    if (m[0] === '.' && /^\s+[a-z]/.test(after) && !/^\s+[a-z]\s+[A-Z]/.test(after)) continue;
    out.push(t.slice(start, end).trim());
    start = end;
  }
  // A text (or tail) without closing punctuation is still a sentence.
  const tail = t.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Number of sentences in a prose text (splitSentences). */
export function sentenceCount(text: string): number {
  return splitSentences(text).length;
}

/**
 * A catalog code in prose ("M42", "NGC 752", "HD 12345"). The voice rule is a common name when one exists, so the
 * build reports this as a note, not an error (some objects have no other name).
 */
export const CATALOG_CODE = /\b(?:M|NGC|IC|HD|HIP|HR|SAO|Mel|Cr|Tr|Stock|Sh2-?)\s?\d+\b/;
