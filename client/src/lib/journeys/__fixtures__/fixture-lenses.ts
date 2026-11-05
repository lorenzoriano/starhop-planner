/**
 * Fixture theme lenses (owner feedback r2) over the winter fixture KB, for engine / narration / build tests. Not
 * shipped content: the real lens files live in script/journeys/curated/lenses/<archetype>.json.
 *
 * A1 (cradle to grave) runs nursery → newborn family (up to 2 stops) → grown family → aging giant → death, at least
 * 3 beats. A2 (thermometer) runs ember → orange → blue-white, at least 2 beats. Objects left out on purpose:
 * HR1895 and M35 / NGC2158 have no A1 lens, so an A1 journey never uses them.
 */
import { FIXTURE_KB } from './fixture-kb';
import type { KnowledgeBase, SwitchRule, ThemeLensSet } from '../types';

export const FIXTURE_LENS_A1: ThemeLensSet = {
  archetype: 'A1',
  storyline: 'A star’s life told in order across one patch of sky: a cloud that is making stars, the family it leaves behind, that family grown up, a star swollen with age, and the wreck a dead star leaves.',
  beats: [
    { step: 1, label: 'Nursery' },
    { step: 2, label: 'Newborn family', maxStops: 2 },
    { step: 3, label: 'Grown family' },
    { step: 4, label: 'Aging giant' },
    { step: 5, label: 'What remains' },
  ],
  minBeats: 3,
  transitions: {
    pairs: {
      '1>2': ['The cloud around {prev} is still busy making stars; {next} shows the kind of family it will leave once the gas is gone.'],
      '2>2': ['{next} belongs to the same young generation as {prev}, a few million years further along.'],
      '2>4': ['Families like {prev} hold heavy stars, and heavy stars age fast: {next} shows where they are headed.'],
    },
    arrive: {
      2: ['Once the gas clears, a nursery like {prev} leaves a family of stars like {next}.'],
      3: ['Give a family like {prev} a hundred million years and it looks like {next}.'],
      4: ['Families grow old one star at a time, and {next} is one of the stars that has started.'],
      5: ['Every star ends somewhere, and {next} is what one ending looks like.'],
    },
  },
  objects: {
    M42: { step: 1, beat: 'Nursery', question: 'Can you see stars being born from your backyard?', why: 'Every life on tonight’s path starts in a cloud like this one.', look: 'Look for the soft gray glow around the tight knot of stars in Orion’s Sword.', answer: 'Yes: the glow is gas lit by stars only about a million years old, and the cloud is still making more.' },
    M43: { step: 1, beat: 'Second nursery', question: 'Why does a small bubble sit beside the great nebula?', why: 'A second, smaller cradle in the same cloud shows that one cloud makes many families.', answer: 'A single young star has blown its own cavity in the same cloud, a separate cradle inside the larger one.' },
    NGC1981: { step: 2, beat: 'Newborn family', question: 'What does a star family look like once its cloud is gone?', why: 'This is the nursery’s future: the same kind of family with its gas already blown away.', look: 'A loose handful of stars just north of the nebula, with no glow left around them.', answer: 'A few million years after birth the gas is gone and only the stars remain, still close together.' },
    'AST-OrionBelt': { step: 2, beat: 'Older siblings', question: 'Are Orion’s Belt stars related to the nebula below them?', why: 'The Belt stars are the same family’s older, heavier members.', answer: 'Yes: they formed from the same great cloud a few million years earlier, and they are heavy enough to die young.' },
    Cr69: { step: 2, beat: 'Newborn family', question: 'Why does Orion’s head hold a little ring of stars?', why: 'Another young family of the same generation, born a little earlier than the nebula’s.', answer: 'It is a young cluster whose massive stars blew the gas into a ring around it.' },
    M45: { step: 3, beat: 'Grown family', question: 'What happens to a star family after a hundred million years?', why: 'The family has grown up: still together, but its brightest stars are no longer newborns.', look: 'Count the bright blue-white stars in the little dipper shape.', answer: 'It stays together for a while, but its heaviest stars are already gone and the rest slowly drift apart.' },
    'AST-Hyades': { step: 3, beat: 'Grown family', question: 'Why does the Hyades look looser than the Pleiades?', why: 'An older family that has had five times longer to loosen.', answer: 'At about six hundred million years it has lost its blue giants and its members are spreading out.' },
    'STAR-Aldebaran': { step: 4, beat: 'Aging giant', question: 'What happens to a star when it runs low on fuel?', why: 'An ordinary star in old age shows the next chapter of the story.', look: 'Notice the steady orange color next to the white stars of the Hyades.', answer: 'It swells into a cool, orange giant, many times wider than the Sun.' },
    'STAR-Betelgeuse': { step: 4, beat: 'Doomed giant', question: 'Why is Betelgeuse so red?', why: 'A heavy star near the end of its life, the fate waiting for the Belt’s blue stars.', look: 'Compare its orange-red with Rigel’s blue-white across Orion.', answer: 'It has swollen into a cool red supergiant, and a star this heavy will end as a supernova.' },
    M1: { step: 5, beat: 'What remains', question: 'What does a star leave behind after it explodes?', why: 'The last chapter of a heavy star: the wreck it leaves behind.', answer: 'A cloud of debris still racing outward, with a spinning neutron star at its heart.' },
  },
};

export const FIXTURE_LENS_A2: ThemeLensSet = {
  archetype: 'A2',
  storyline: 'Color is temperature: from the cool ember of a red supergiant through an orange giant to a blue-white star, read by eye.',
  beats: [
    { step: 1, label: 'Ember', maxStops: 2 },
    { step: 2, label: 'Orange' },
    { step: 3, label: 'Blue-white' },
  ],
  minBeats: 2,
  transitions: {
    arrive: {
      1: ['{next} glows with the same cool light as {prev}.'],
      2: ['From {prev} to {next} the color warms a step toward yellow.'],
      3: ['Set {next} beside {prev}: blue-white means a surface several times hotter.'],
    },
  },
  objects: {
    'STAR-Betelgeuse': { step: 1, beat: 'Ember', question: 'What does Betelgeuse’s color say about its surface?', why: 'The coolest star of the night sets the bottom of the scale.', look: 'Its orange-red is plain to the eye and stronger in binoculars.', answer: 'It is cool for a star, about 3,600 degrees, which is why it glows like an ember.' },
    'STAR-Aldebaran': { step: 1, beat: 'Ember', question: 'Is Aldebaran as cool as it looks?', why: 'A second cool star to calibrate your eye at the red end.', answer: 'Nearly: at about 3,900 degrees it is a little warmer than Betelgeuse and a little less red.' },
    'STAR-Capella': { step: 2, beat: 'Orange', question: 'Why does Capella look yellow rather than orange?', why: 'The middle of the scale, close to the Sun’s own color.', answer: 'Its surface runs near 5,000 degrees, close to the Sun’s, so it shines a warm yellow.' },
    HR1713: { step: 3, beat: 'Blue-white', question: 'How hot does a star have to be to look blue-white?', why: 'The hot end of tonight’s thermometer.', look: 'Rigel’s blue-white beside Betelgeuse’s orange-red is the whole scale in one constellation.', answer: 'Above about 10,000 degrees: Rigel’s surface is over 12,000, so blue light wins.' },
  },
};

/** Theme-level narration overrides as a lens file would carry them (the build merges them into the bank). */
export const FIXTURE_LENS_NARRATION: Record<string, string[]> = {
  'title.A1-cradle-to-grave': ['A Life Story in {region}'],
  'payoff.A1-cradle-to-grave': ['Every chapter of a star’s life sits in this one patch of sky, from the cloud that makes it to the wreck it leaves, and you just read them in order.'],
  'switch.A1-cradle-to-grave': ['That giant’s color is a clue to something else.'],
};

/** Switch rule A1 → A2 (the lens tests check that a lens theme ignores it). */
export const FIXTURE_LENS_SWITCH: SwitchRule = { to: ['A2-thermometer'], atArc: 'payoff', via: ['CONTRAST', 'LIFE_NEXT'], minStrength: 0.6, announceKey: 'switch.A1-cradle-to-grave' };

/**
 * The fixture KB with the lens sets (and, as the build would, the lens narration merged into the bank).
 * `opts.lenses` picks the sets (default both); `opts.switch` adds the A1 → A2 switch rule.
 */
export function lensFixtureKb(opts: { lenses?: ThemeLensSet[]; switch?: boolean; version?: string } = {}): KnowledgeBase {
  // The switch fixture ends A1's story at the aging giant, so Betelgeuse (with an A2 lens) could close it and open the
  // thermometer; a lens theme never switches (round 3), so the engine must still return A1 journeys without one.
  const a1ForSwitch: ThemeLensSet = {
    ...FIXTURE_LENS_A1,
    beats: FIXTURE_LENS_A1.beats.filter((b) => b.step < 5),
    objects: Object.fromEntries(Object.entries(FIXTURE_LENS_A1.objects).filter(([, l]) => l.step < 5)),
  };
  const lenses = opts.lenses ?? [opts.switch ? a1ForSwitch : FIXTURE_LENS_A1, FIXTURE_LENS_A2];
  const templates = FIXTURE_KB.templates.map((t) => (opts.switch && t.id === 'A1-cradle-to-grave' ? { ...t, chainTo: ['A2-thermometer'], switchRule: FIXTURE_LENS_SWITCH } : t));
  return {
    ...FIXTURE_KB,
    version: opts.version ?? `fixture-lenses-${lenses.map((l) => l.archetype).join('')}${opts.switch ? '-sw' : ''}`,
    templates,
    narration: { ...FIXTURE_KB.narration, variants: { ...FIXTURE_KB.narration.variants, ...FIXTURE_LENS_NARRATION } },
    lenses,
  };
}
