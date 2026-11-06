import { describe, expect, it } from 'vitest';
import {
  SKY_PRESETS, skyPresetFor, isPresetSqm, sqmFromNelm, nelmFromSqm, sqmFromQuiz,
  TRANSPARENCY_OPTIONS, TAU_NORMAL, extinctionForTransparency, extinctionFromForecast, transparencyFromForecast, transparencyForTau,
  observerFor, resolveSkyInputs,
} from '../visibility/conditions';

describe('sky darkness presets and quiz', () => {
  it('orders presets from bright to dark inside the Bortle/SQM ranges', () => {
    const values = SKY_PRESETS.map((p) => p.sqm);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values[0]).toBe(17.5);
    expect(values.at(-1)).toBe(21.8);
    for (const p of SKY_PRESETS) expect(p.cue.length).toBeGreaterThan(10);
  });
  it('finds the nearest preset for any stored value, including the old references', () => {
    expect(skyPresetFor(17.5).id).toBe('city');
    expect(skyPresetFor(19.0).id).toBe('bright-suburb'); // old "urban conservative" 19.0 sits between 18.5 and 19.5
    expect(skyPresetFor(19.1).id).toBe('suburb');
    expect(skyPresetFor(20.5).id).toBe('rural-edge');
    expect(skyPresetFor(21.6).id).toBe('remote');
    expect(skyPresetFor(22).id).toBe('remote');
    expect(isPresetSqm(21.3)).toBe(true);
    expect(isPresetSqm(19.0)).toBe(false);
  });
  it('converts NELM and SQM with the Unihedron formula (spec §5.1/§10 table)', () => {
    expect(sqmFromNelm(2.8)).toBeCloseTo(16.7, 1);
    expect(sqmFromNelm(4.4)).toBeCloseTo(18.5, 0);
    expect(sqmFromNelm(5.0)).toBeCloseTo(19.3, 0);
    expect(sqmFromNelm(5.8)).toBeCloseTo(20.5, 1);
    for (const sqm of [18, 19.5, 21]) expect(sqmFromNelm(nelmFromSqm(sqm))).toBeCloseTo(sqm, 6);
  });
  it('turns quick answers into a sky value (median of answers, clamped to 17–22)', () => {
    expect(sqmFromQuiz({})).toBeNull();
    expect(sqmFromQuiz({ milkyWay: 'faint' })).toBe(19.5);
    expect(sqmFromQuiz({ milkyWay: 'detail' })).toBe(21.5);
    expect(sqmFromQuiz({ littleDipper: 2 })).toBe(17); // 16.7 clamped to the stored range
    const both = sqmFromQuiz({ milkyWay: 'clear', littleDipper: '7+' })!;
    expect(both).toBeGreaterThan(20.4);
    expect(both).toBeLessThan(20.7);
    expect(skyPresetFor(sqmFromQuiz({ milkyWay: 'no', littleDipper: 3 })!).id).toBe('city');
  });
});

describe('haze and extinction', () => {
  it('matches the spec sea-level k for the five haze levels', () => {
    const k = TRANSPARENCY_OPTIONS.map((o) => extinctionForTransparency(o.value, 0));
    [0.20, 0.23, 0.28, 0.40, 0.58].forEach((expected, i) => expect(k[i]).toBeCloseTo(expected, 1));
    expect(extinctionForTransparency(3, 0)).toBeCloseTo(0.281, 3);
  });
  it('drops with elevation (Green 1992: 1 km ≈ 0.21, 2.2 km ≈ 0.15)', () => {
    expect(extinctionForTransparency(3, 1000)).toBeCloseTo(0.21, 2);
    expect(extinctionForTransparency(3, 2200)).toBeCloseTo(0.15, 1);
  });
  it('prefers aerosol optical depth and ignores humidity then', () => {
    const clear = extinctionFromForecast({ aod: 0.05, visibilityM: 5000, humidity: 95 }, 0)!;
    expect(clear.basis).toBe('aod');
    expect(clear.k).toBeCloseTo(0.1451 + 0.016 + 1.19 * 0.05, 2);
    expect(transparencyFromForecast({ aod: 0.05 })!.label).toBe('Clear');
    expect(transparencyFromForecast({ aod: 0.12 })!.label).toBe('Normal');
    expect(transparencyFromForecast({ aod: 0.3 })!.label).toBe('Hazy / humid');
    expect(transparencyFromForecast({ aod: 0.8 })!.level).toBe(5);
  });
  it('uses short visibility as haze but treats capped long visibility as an average night', () => {
    const v10 = extinctionFromForecast({ visibilityM: 10000 }, 0)!;
    expect(v10.basis).toBe('visibility');
    expect(v10.tau).toBeCloseTo(0.49, 1);
    const capped = extinctionFromForecast({ visibilityM: 24140, humidity: 40 }, 0)!;
    expect(capped.k).toBeCloseTo(extinctionForTransparency(3, 0), 3);
    expect(transparencyForTau(capped.tau)).toBe(3);
    // Monotonic: less visibility, more extinction.
    const ks = [30000, 20000, 15000, 10000, 5000].map((v) => extinctionFromForecast({ visibilityM: v }, 0)!.k);
    for (let i = 1; i < ks.length; i++) expect(ks[i]).toBeGreaterThanOrEqual(ks[i - 1]);
  });
  it('lets humidity swell the average-night haze when visibility says nothing', () => {
    const dry = extinctionFromForecast({ humidity: 40 }, 0)!, humid = extinctionFromForecast({ humidity: 95 }, 0)!;
    expect(dry.basis).toBe('humidity');
    expect(dry.k).toBeCloseTo(extinctionForTransparency(3, 0), 3);
    expect(humid.k).toBeGreaterThan(dry.k + 0.2);
    expect(transparencyFromForecast({ visibilityM: 24000, humidity: 95 })!.level).toBe(4);
    expect(extinctionFromForecast({}, 0)).toBeNull();
    expect(extinctionFromForecast({ aod: null, visibilityM: null, humidity: null }, 0)).toBeNull();
  });
});

describe('forecast haze is a relative index, scaled by elevation', () => {
  const MAUNA_KEA = 4169, DENVER = 1600;
  it('pins the reference optical depth to Green\'s average night (k_aer 0.12 at sea level)', () => {
    expect(TAU_NORMAL).toBeCloseTo(0.1, 2);
    expect(extinctionFromForecast({ aod: TAU_NORMAL }, 0)!.k).toBeCloseTo(extinctionForTransparency(3, 0), 6);
    expect(extinctionFromForecast({ aod: TAU_NORMAL }, MAUNA_KEA)!.k).toBeCloseTo(extinctionForTransparency(3, MAUNA_KEA), 6);
  });
  it('at equal haze a higher site always has less extinction, and the label does not depend on elevation', () => {
    for (const aod of [0.02, 0.07, 0.1, 0.2, 0.48, 1.2]) {
      const [sea, denver, mk] = [0, DENVER, MAUNA_KEA].map((h) => extinctionFromForecast({ aod }, h)!.k);
      expect(denver).toBeLessThan(sea);
      expect(mk).toBeLessThan(denver);
      expect(transparencyFromForecast({ aod }, MAUNA_KEA)!.level).toBe(transparencyFromForecast({ aod }, 0)!.level);
    }
  });
  it('keeps k on the same side of the elevation\'s average night as the label (Clear below, Hazy above)', () => {
    for (const h of [0, DENVER, MAUNA_KEA]) {
      const normal = extinctionForTransparency(3, h);
      expect(extinctionFromForecast({ aod: 0.07 }, h)!.k).toBeLessThan(normal);
      expect(extinctionFromForecast({ aod: 0.3 }, h)!.k).toBeGreaterThan(normal);
    }
    // Mauna Kea, CAMS AOD 0.07 ("Clear"): below its own average night (≈ 0.110), not 0.186 as with the full column τ.
    const mk = extinctionFromForecast({ aod: 0.07 }, MAUNA_KEA)!;
    expect(transparencyFromForecast({ aod: 0.07 }, MAUNA_KEA)!.label).toBe('Clear');
    expect(mk.k).toBeLessThan(extinctionForTransparency(3, MAUNA_KEA));
    expect(mk.k).toBeGreaterThan(extinctionForTransparency(1, MAUNA_KEA));
    // Denver-like (1.6 km, AOD 0.1 ≈ an average night): a little better than sea level.
    const denver = extinctionFromForecast({ aod: 0.1 }, DENVER)!.k, sea = extinctionFromForecast({ aod: 0.1 }, 0)!.k;
    expect(denver).toBeLessThan(sea - 0.05);
    expect(denver).toBeGreaterThan(sea - 0.15);
    // Delhi smoke (AOD 0.48, 217 m) stays Smoky and far worse than either.
    const delhi = extinctionFromForecast({ aod: 0.48 }, 217)!.k;
    expect(transparencyFromForecast({ aod: 0.48 }, 217)!.label).toBe('Smoky / very hazy');
    expect(delhi).toBeGreaterThan(0.6);
    expect(delhi).toBeGreaterThan(2 * sea);
  });
  it('scales the visibility and humidity fallbacks the same way', () => {
    expect(extinctionFromForecast({ humidity: 40 }, MAUNA_KEA)!.k).toBeCloseTo(extinctionForTransparency(3, MAUNA_KEA), 6);
    expect(extinctionFromForecast({ visibilityM: 24140, humidity: 40 }, MAUNA_KEA)!.k).toBeCloseTo(extinctionForTransparency(3, MAUNA_KEA), 6);
    for (const hour of [{ humidity: 95 }, { visibilityM: 8000 }, { visibilityM: 15000, humidity: 80 }]) {
      const sea = extinctionFromForecast(hour, 0)!, high = extinctionFromForecast(hour, MAUNA_KEA)!;
      expect(high.tau).toBeCloseTo(sea.tau, 9);
      expect(high.k).toBeLessThan(sea.k);
    }
  });
});

describe('observer and resolveSkyInputs', () => {
  it('maps age brackets to a dark-adapted pupil', () => {
    expect(observerFor('under-30')).toEqual({ pupil: 7, fieldFactor: 2 });
    expect(observerFor('30-49').pupil).toBe(6);
    expect(observerFor('50-plus').pupil).toBe(5);
    expect(observerFor(undefined).pupil).toBe(6);
  });
  it('defaults to an average night at the forecast elevation without forecast data', () => {
    const s = resolveSkyInputs({ skyBrightness: 20.5, elevationM: 1000 });
    expect(s).toMatchObject({ zenithSqm: 20.5, elevationM: 1000, elevationSource: 'forecast', extinctionSource: 'default', transparency: 3 });
    expect(s.extinctionK).toBeCloseTo(0.21, 2);
    expect(resolveSkyInputs({ skyBrightness: 19 }).elevationSource).toBe('unknown');
  });
  it('uses the forecast in auto mode and a manual haze level over it', () => {
    const auto = resolveSkyInputs({ skyBrightness: 21, transparencyMode: 'auto', airQualityHour: { aod: 0.4 }, forecastHour: { visibility: 24000, humidity: 50 } });
    expect(auto).toMatchObject({ extinctionSource: 'forecast', forecastBasis: 'aod', transparency: 5 });
    const manual = resolveSkyInputs({ skyBrightness: 21, transparencyMode: 1, airQualityHour: { aod: 0.4 } });
    expect(manual.extinctionSource).toBe('manual');
    expect(manual.transparency).toBe(1);
    expect(manual.extinctionK).toBeCloseTo(0.2, 1);
  });
  it('lets a manual elevation win and passes Moon and Sun through', () => {
    const moon = { alt: 30, ra: 10, dec: 5, phaseAngle: 60, illumination: 0.75 };
    const s = resolveSkyInputs({ skyBrightness: 21.3, siteElevation: 2200, elevationM: 14, moon, sunAlt: -25 });
    expect(s.elevationM).toBe(2200);
    expect(s.elevationSource).toBe('manual');
    expect(s.moon).toBe(moon);
    expect(s.sunAlt).toBe(-25);
    expect(s.extinctionK).toBeLessThan(0.17);
  });
});
