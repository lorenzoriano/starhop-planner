/**
 * Tonight's conditions for the binocular visibility model, in words a normal observer can answer
 * (docs/binocular-visibility-research.md §2.1, §4.2, §5.1, §10). Pure functions only: the hook
 * hooks/use-visibility-conditions.ts feeds them the forecast, the air-quality forecast and the settings.
 */
import type { Observer, SkyInputs, Transparency } from './types';

// ───────────────────────────── sky darkness ─────────────────────────────

export type SkyPresetId = 'city' | 'bright-suburb' | 'suburb' | 'rural-edge' | 'countryside' | 'remote';
export interface SkyPreset {
  id: SkyPresetId;
  /** "Suburb" */
  label: string;
  /** Short lowercase form for "your … sky" ("bright-suburb"). */
  short: string;
  /** The Milky Way / star cue the observer can check by eye. */
  cue: string;
  /** Moonless zenith sky brightness, mag/arcsec² (spec §5.1 Bortle/SQM table). */
  sqm: number;
  /** Bortle class(es), for the advanced line. */
  bortle: string;
}

/** Darkest last. Values sit inside the spec's Bortle/SQM ranges (§5.1) and the "Where are you?" table (§10). */
export const SKY_PRESETS: readonly SkyPreset[] = [
  { id: 'city', label: 'City centre', short: 'city-centre', cue: 'Only the brightest stars; no Milky Way', sqm: 17.5, bortle: '8–9' },
  { id: 'bright-suburb', label: 'Bright suburb or town', short: 'bright-suburb', cue: 'Main constellation stars only; no Milky Way', sqm: 18.5, bortle: '7' },
  { id: 'suburb', label: 'Suburb', short: 'suburban', cue: 'Plenty of stars, but the Milky Way is invisible', sqm: 19.5, bortle: '5–6' },
  { id: 'rural-edge', label: 'Edge of town or village', short: 'edge-of-town', cue: 'Milky Way faint overhead', sqm: 20.5, bortle: '4–5' },
  { id: 'countryside', label: 'Dark countryside', short: 'dark-countryside', cue: 'Milky Way obvious, with dark lanes and structure', sqm: 21.3, bortle: '3' },
  { id: 'remote', label: 'Remote dark site', short: 'remote dark-site', cue: 'Milky Way detailed down to the horizon; sky crowded with stars', sqm: 21.8, bortle: '1–2' },
];

/** The preset closest to a stored sky value (any value 17–22 stays allowed; the UI marks inexact matches). */
export function skyPresetFor(sqm: number): SkyPreset {
  return SKY_PRESETS.reduce((best, preset) => (Math.abs(preset.sqm - sqm) < Math.abs(best.sqm - sqm) ? preset : best));
}
/** True when `sqm` is exactly one of the presets (to one decimal, as stored). */
export const isPresetSqm = (sqm: number) => SKY_PRESETS.some((preset) => Math.abs(preset.sqm - sqm) < 0.05);

/** Empirical NELM ↔ SQM (Schaefer-derived, Unihedron; spec §5.1). Valid for NELM < 7.9. */
export function sqmFromNelm(nelm: number): number {
  const n = Math.min(nelm, 7.5);
  return 21.58 - 5 * Math.log10(10 ** (1.586 - n / 5) - 1);
}
export function nelmFromSqm(sqm: number): number {
  return 7.93 - 5 * Math.log10(10 ** (4.316 - sqm / 5) + 1);
}

export type MilkyWayAnswer = 'no' | 'faint' | 'clear' | 'detail';
/** Stars of the Little Dipper seen: 2 (Polaris, Kochab), 3, 4 (4–6), 7 (all), or '7+' (fainter stars inside the bowl). */
export type LittleDipperAnswer = 2 | 3 | 4 | 7 | '7+';

export const MILKY_WAY_ANSWERS: readonly { value: MilkyWayAnswer; label: string; sqm: number }[] = [
  { value: 'no', label: 'No', sqm: 18.3 },
  { value: 'faint', label: 'Faintly, overhead', sqm: 19.5 },
  { value: 'clear', label: 'Clearly', sqm: 20.6 },
  { value: 'detail', label: 'With detail to the horizon', sqm: 21.5 },
];
/** Faintest Little Dipper star seen (Polaris 2.0, Kochab 2.1, Pherkad 3.0, ε 4.2, ζ 4.3, δ 4.4, η 5.0) → NELM (spec §10). */
export const LITTLE_DIPPER_ANSWERS: readonly { value: LittleDipperAnswer; label: string; nelm: number }[] = [
  { value: 2, label: '2', nelm: 2.8 },
  { value: 3, label: '3', nelm: 3.6 },
  { value: 4, label: '4–6', nelm: 4.4 },
  { value: 7, label: 'All 7', nelm: 5.0 },
  { value: '7+', label: '7 + more inside', nelm: 5.8 },
];

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Sky darkness from the two quick questions. Median (mean for two) of the answered estimates, clamped to the
 * stored range 17–22 and rounded to 0.1. Null when nothing is answered.
 */
export function sqmFromQuiz(answers: { milkyWay?: MilkyWayAnswer | null; littleDipper?: LittleDipperAnswer | null }): number | null {
  const estimates: number[] = [];
  const mw = MILKY_WAY_ANSWERS.find((a) => a.value === answers.milkyWay);
  if (mw) estimates.push(mw.sqm);
  const ld = LITTLE_DIPPER_ANSWERS.find((a) => a.value === answers.littleDipper);
  if (ld) estimates.push(sqmFromNelm(ld.nelm));
  if (!estimates.length) return null;
  estimates.sort((a, b) => a - b);
  const mid = estimates.length / 2;
  const median = estimates.length % 2 ? estimates[Math.floor(mid)] : (estimates[mid - 1] + estimates[mid]) / 2;
  return round1(clamp(median, 17, 22));
}

// ───────────────────────────── haze / extinction ─────────────────────────────

export interface TransparencyOption {
  value: Transparency;
  label: string;
  hint: string;
  /** Green 1992 aerosol scale s_aer (spec §4.2). */
  aerosolScale: number;
}
export const TRANSPARENCY_OPTIONS: readonly TransparencyOption[] = [
  { value: 1, label: 'Crisp', hint: 'After rain or a cold front; stars sharp right down to the horizon', aerosolScale: 0.3 },
  { value: 2, label: 'Clear', hint: 'Deep-blue daytime sky; stars good down to about 20°', aerosolScale: 0.6 },
  { value: 3, label: 'Normal', hint: 'A typical night; stars fade a little low down', aerosolScale: 1.0 },
  { value: 4, label: 'Hazy / humid', hint: 'Milky sky near the horizon; halos round streetlights', aerosolScale: 2.0 },
  { value: 5, label: 'Smoky / very hazy', hint: 'Smoke, dust or heavy haze; few stars low down', aerosolScale: 3.5 },
];
export const transparencyLabel = (t: Transparency) => TRANSPARENCY_OPTIONS[t - 1].label;

const K_OZONE = 0.016;
/** Green 1992 Rayleigh term at the scotopic peak, h in metres. */
const kRayleigh = (elevationM: number) => 0.1451 * Math.exp(-Math.max(0, elevationM) / 1000 / 7.996);
/** Green 1992 aerosol term for an average night (s_aer = 1), h in metres. */
const kAerosolNormal = (elevationM: number) => 0.12 * Math.exp(-Math.max(0, elevationM) / 1000 / 1.5);
/** k_aer ≈ 1.086·τ550·(550/510)^1.3 (spec §4.2). */
const K_PER_TAU = 1.086 * (550 / 510) ** 1.3;

/** V-band extinction (mag/airmass) for a named haze level at this elevation (spec §4.2). Sea level: 0.20 … 0.58. */
export function extinctionForTransparency(t: Transparency, elevationM = 0): number {
  return extinctionForAerosol(TRANSPARENCY_OPTIONS[t - 1].aerosolScale, elevationM);
}
/** V-band extinction for Green's aerosol scale s_aer (1 = average night) at this elevation (spec §4.2). */
export function extinctionForAerosol(aerosolScale: number, elevationM = 0): number {
  return kRayleigh(elevationM) + kAerosolNormal(elevationM) * aerosolScale + K_OZONE;
}

export interface ForecastHaze {
  /** Extinction coefficient, mag/airmass. */
  k: number;
  /** Aerosol optical depth at 550 nm used (measured or inferred), read as a sea-level-equivalent haze index:
   *  s_aer = tau / TAU_NORMAL sets k at the site's elevation (see TAU_NORMAL). */
  tau: number;
  /** What the estimate rests on. */
  basis: 'aod' | 'visibility' | 'humidity';
}

/** Above this the forecast visibility is usually capped (~24 km), so it says "no haze seen", not "crisp" (spec §4.2). */
const VIS_UNINFORMATIVE_M = 20000, VIS_INFORMATIVE_M = 12000;
const AEROSOL_HEIGHT_KM = 1.3;
/**
 * Optical depth of an average night at sea level, matching Green's aerosol term (0.12 mag at s_aer = 1): τ ≈ 0.10.
 * Forecast haze is read relative to this, s_aer = τ / TAU_NORMAL, and then scaled with elevation by Green's
 * formula. CAMS AOD (and the visibility/humidity proxies) describe a coarse grid cell whose surface is often near
 * sea level for island or mountain sites, so applying the column τ in full at a high site would rate Mauna Kea
 * hazier than an average night there. As a relative index, the label, k and the sky-glow haze factor
 * (k / k_average) agree, and at equal haze a higher site always does better.
 */
export const TAU_NORMAL = 0.12 / K_PER_TAU;

/**
 * Extinction from one forecast hour (spec §4.2), via a sea-level-equivalent optical depth τ:
 * 1. CAMS aerosol optical depth (Open-Meteo air-quality `aerosol_optical_depth`), preferred; it already includes humidity.
 * 2. Else horizontal visibility (Koschmieder) – only trusted below ~20 km, since the product is capped; at long
 *    visibility it falls back to an average night;
 * 3. … with relative humidity (> 50 %) swelling that average-night aerosol.
 * k = extinctionForAerosol(τ / TAU_NORMAL, elevation). Returns null when the hour has none of these.
 */
export function extinctionFromForecast(hour: { aod?: number | null; visibilityM?: number | null; humidity?: number | null }, elevationM = 0): ForecastHaze | null {
  const result = (tau: number, basis: ForecastHaze['basis']): ForecastHaze => ({ k: extinctionForAerosol(tau / TAU_NORMAL, elevationM), tau, basis });
  if (hour.aod != null && Number.isFinite(hour.aod) && hour.aod >= 0) return result(Math.min(hour.aod, 3), 'aod');
  const hasVis = hour.visibilityM != null && Number.isFinite(hour.visibilityM) && hour.visibilityM > 0;
  const hasRh = hour.humidity != null && Number.isFinite(hour.humidity);
  if (!hasVis && !hasRh) return null;
  // Average-night aerosol, swollen by humidity (hygroscopic growth, capped at RH 95 %).
  const rh = hasRh ? clamp(hour.humidity! / 100, 0, 0.95) : 0;
  const growth = rh > 0.5 ? ((1 - rh) / 0.5) ** -0.5 : 1;
  const tauNormal = TAU_NORMAL * growth;
  if (!hasVis) return result(tauNormal, 'humidity');
  const vKm = hour.visibilityM! / 1000;
  const tauVis = Math.max(3.912 / vKm - 0.0116, 0) * AEROSOL_HEIGHT_KM;
  // Long visibility only says "no obvious haze": blend towards the average night (never above what visibility allows).
  const w = clamp((hour.visibilityM! - VIS_INFORMATIVE_M) / (VIS_UNINFORMATIVE_M - VIS_INFORMATIVE_M), 0, 1);
  return result(Math.min((1 - w) * tauVis + w * Math.min(tauVis, tauNormal), 3), 'visibility');
}

/** Haze level to show for an optical depth ("Forecast: Hazy"). Typical τ550: 0.05 very clear, 0.1–0.15 normal, 0.3 hazy, > 0.5 smoke (spec §4.2). */
export function transparencyForTau(tau: number): Transparency {
  return tau < 0.045 ? 1 : tau < 0.085 ? 2 : tau < 0.18 ? 3 : tau < 0.4 ? 4 : 5;
}
/** The haze level the forecast hour implies, for display, or null without forecast data. */
export function transparencyFromForecast(hour: { aod?: number | null; visibilityM?: number | null; humidity?: number | null }, elevationM = 0): { level: Transparency; label: string; basis: ForecastHaze['basis'] } | null {
  const haze = extinctionFromForecast(hour, elevationM);
  if (!haze) return null;
  const level = transparencyForTau(haze.tau);
  return { level, label: transparencyLabel(level), basis: haze.basis };
}

// ───────────────────────────── observer ─────────────────────────────

export type AgeBracket = 'under-30' | '30-49' | '50-plus';
export const AGE_BRACKETS: readonly { value: AgeBracket; label: string }[] = [
  { value: 'under-30', label: 'Under 30' },
  { value: '30-49', label: '30–49' },
  { value: '50-plus', label: '50+' },
];
/** Dark-adapted pupil from p = 7 − 0.05·(age − 20) at a typical age per bracket (25 / 40 / 60; spec §2.1); typical observer F = 2 (§2.2). */
export function observerFor(age: AgeBracket | undefined | null): Observer {
  const pupil = age === 'under-30' ? 7.0 : age === '50-plus' ? 5.0 : 6.0;
  return { pupil, fieldFactor: 2 };
}

// ───────────────────────────── everything together ─────────────────────────────

export type TransparencyMode = 'auto' | Transparency;

export interface ConditionPrefs {
  /** Stored moonless zenith sky brightness for the site (settings.skyBrightness). */
  skyBrightness: number;
  transparencyMode?: TransparencyMode;
  /** Manual elevation override, metres; null/undefined = from the forecast. */
  siteElevation?: number | null;
}

export interface ResolvedSkyInputs extends SkyInputs {
  /** The haze level in effect (manual choice, the forecast's, or Normal). */
  transparency: Transparency;
  elevationSource: 'manual' | 'forecast' | 'unknown';
  /** What a forecast-based k rests on. */
  forecastBasis?: ForecastHaze['basis'];
}

/**
 * Combine settings, the forecast hour and the air-quality hour into SkyInputs.
 * A manual haze level wins over the forecast; with no forecast data, k is the average night (Normal) for the elevation.
 */
export function resolveSkyInputs(o: ConditionPrefs & {
  forecastHour?: { visibility?: number | null; humidity?: number | null } | null;
  airQualityHour?: { aod?: number | null } | null;
  /** Elevation from the forecast service (metres), when known. */
  elevationM?: number | null;
  moon?: SkyInputs['moon'];
  sunAlt?: number;
}): ResolvedSkyInputs {
  const manualElevation = o.siteElevation != null && Number.isFinite(o.siteElevation);
  const forecastElevation = o.elevationM != null && Number.isFinite(o.elevationM);
  const elevationM = manualElevation ? o.siteElevation! : forecastElevation ? o.elevationM! : 0;
  const elevationSource = manualElevation ? 'manual' : forecastElevation ? 'forecast' : 'unknown';
  const mode = o.transparencyMode ?? 'auto';
  let extinctionK: number, extinctionSource: SkyInputs['extinctionSource'], transparency: Transparency, forecastBasis: ForecastHaze['basis'] | undefined;
  const haze = mode === 'auto'
    ? extinctionFromForecast({ aod: o.airQualityHour?.aod, visibilityM: o.forecastHour?.visibility, humidity: o.forecastHour?.humidity }, elevationM)
    : null;
  if (mode !== 'auto') {
    transparency = mode; extinctionK = extinctionForTransparency(mode, elevationM); extinctionSource = 'manual';
  } else if (haze) {
    transparency = transparencyForTau(haze.tau); extinctionK = haze.k; extinctionSource = 'forecast'; forecastBasis = haze.basis;
  } else {
    transparency = 3; extinctionK = extinctionForTransparency(3, elevationM); extinctionSource = 'default';
  }
  return {
    zenithSqm: o.skyBrightness, elevationM, extinctionK, extinctionSource, transparency, elevationSource,
    ...(forecastBasis ? { forecastBasis } : {}),
    ...(o.sunAlt !== undefined ? { sunAlt: o.sunAlt } : {}),
    ...(o.moon !== undefined ? { moon: o.moon } : {}),
  };
}
