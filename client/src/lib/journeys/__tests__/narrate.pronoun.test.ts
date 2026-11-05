import { describe, expect, it } from 'vitest';
import { pronounAfter, proseName } from '../narrate';

describe('pronounAfter (payoff stop: thread line + curated why-here)', () => {
  it('continues with It/Its when the thread line already names the stop', () => {
    const lead = "δ Cephei is the last of tonight's changing stars.";
    expect(pronounAfter(lead, 'δ Cephei gave its name to the Cepheids.', 'δ Cephei')).toBe('It gave its name to the Cepheids.');
    expect(pronounAfter(lead, 'δ Cephei’s beat is a ruler.', 'δ Cephei')).toBe('Its beat is a ruler.');
    expect(pronounAfter('The ladder ends at the Andromeda Galaxy, a spiral galaxy.', 'The Andromeda Galaxy is a whole other galaxy.', 'Andromeda Galaxy'))
      .toBe('It is a whole other galaxy.');
  });

  it('leaves the line alone when the thread does not name the stop or the line starts otherwise', () => {
    expect(pronounAfter('The scale tops out here.', 'Rigel is a blue supergiant.', 'Rigel')).toBe('Rigel is a blue supergiant.');
    expect(pronounAfter('Rigel sits at the hot end.', 'Stars like Rigel burn fast.', 'Rigel')).toBe('Stars like Rigel burn fast.');
  });
});

describe('proseName (stop names inside narration)', () => {
  it('drops the parenthesised second name, preferring a common name over a catalog code', () => {
    expect(proseName('Stock 2 (Muscleman Cluster)')).toBe('the Muscleman Cluster');
    expect(proseName('Owl Cluster (ET Cluster)')).toBe('the Owl Cluster');
    expect(proseName('Double Cluster (h Persei)')).toBe('the Double Cluster');
    expect(proseName('Cygnus X-1 (HDE 226868)')).toBe('Cygnus X-1');
    expect(proseName('Winnecke 4 (Messier 40)')).toBe('Winnecke 4');
    expect(proseName('Andromeda Galaxy')).toBe('the Andromeda Galaxy');
    expect(proseName('M35')).toBe('M35');
  });

  it('pronounAfter still recognises a stop named by its prose name', () => {
    expect(pronounAfter('The ladder reaches the Owl Cluster here.', 'Stars of the Owl Cluster lie far beyond.', 'Owl Cluster (ET Cluster)')).toBe('Stars of the Owl Cluster lie far beyond.');
    expect(pronounAfter('The ladder reaches the Owl Cluster here.', 'The Owl Cluster is far beyond.', 'Owl Cluster (ET Cluster)')).toBe('It is far beyond.');
  });
});
