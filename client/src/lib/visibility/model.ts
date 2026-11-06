/**
 * Physically based binocular visibility model (docs/binocular-visibility-research.md).
 *
 * Chain: observer (pupil p, field factor F) → binocular (D, M, exit pupil, transmission, steadiness F_S)
 *   → atmosphere (Green 1992 extinction k, Rozenberg airmass X) → sky at the target (zenith SQM brightened toward the
 *   horizon, Krisciunas & Schaefer 1991 moonlight, twilight) → Crumey 2014 contrast threshold / stellar limit
 *   → margin (log10 contrast units) → 5 levels + plain-English limitations by counterfactual recomputation.
 *
 * Pure functions only; every input is explicit. Constants marked "heuristic" are engineering choices documented in
 * the spec (§3.1, §5.2, §6.2, §7) and are the knobs to tune against observer reports.
 */
import {
  VISIBILITY_LABELS,
  type LimitFactor,
  type Limitation,
  type Observer,
  type Optics,
  type SkyInputs,
  type Support,
  type VisibilityEstimate,
  type VisibilityKind,
  type VisibilityLevel,
  type VisibilityTarget,
} from './types';

// ───────────────────────────── constants ─────────────────────────────

/** Typical observer: 6.5 mm dark-adapted pupil, Crumey's notional field factor F = 2 (spec §2). */
export const DEFAULT_OBSERVER: Observer = { pupil: 6.5, fieldFactor: 2 };

/** Crumey 2014 constants (Blackwell 1946 scotopic fit), eqs 44, 48, 49. */
const R1 = 6.505e-4, R2 = -8.461e-4, K1 = 7.633e-3, K2 = -7.174e-3, Q = 0.6;
/** Crumey's zero-background cut-off (cd/m²). */
const B_MIN = 1e-5;
const RAD = Math.PI / 180;
const ARCMIN_PER_RAD = 3437.75;

/** Natural (unpolluted) zenith sky, mag/arcsec²; anything brighter at the zenith is treated as artificial light. */
export const NATURAL_SKY_MU = 21.9;
/** Haze levels 1–5 → aerosol scale s_aer for Green's k_aer (spec §4.2). */
export const AEROSOL_SCALE: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0.3, 2: 0.6, 3: 1.0, 4: 2.0, 5: 3.5 };

/** Heuristic (spec §6.2): Crumey is optimistic under bright skies; below µ = 19 subtract this many mag per mag of sky
 *  from LM, and raise the extended-object threshold by the same flux factor. */
export const BRIGHT_SKY_PENALTY = 0.25;
const BRIGHT_SKY_PIVOT = 19;

/** Heuristic colour corrections, mag added to the object (spec §7.1): rods are well matched to OIII/Hβ (planetaries).
 *  The spec's Hα penalty (+0.5…1) for emission nebulae is not applied: the bright binocular H II regions (M42, M8,
 *  M17) also shine strongly in OIII/Hβ, and the penalty made them disagree with observer grades. */
export const NEBULA_COLOUR_MAG: Partial<Record<NonNullable<VisibilityTarget['objectClass']>, number>> = {
  planetary: -0.2,
};

/** "Core" variant (spec §7.1): 0.3·a × 0.3·b holding the light of m + 1.0, best of whole/core. The spec applies it to
 *  galaxies and globulars; it is extended here to emission/reflection nebulae, whose light is just as concentrated
 *  (M42's bright core vs its 90′ catalogue extent). */
const CORE_SCALE = 0.3, CORE_MAG = 1.0;
const CORE_CLASSES = new Set<VisibilityTarget['objectClass']>(['galaxy', 'globular', 'emission', 'reflection']);

/** Rating bins on the margin (spec §8.1). */
export const LEVEL_THRESHOLDS = [0.8, 0.4, 0.15, -0.15] as const;

/** Apparent-size limits (spec §7.2), arcmin at the eye (M × major axis). */
const STELLAR_APPARENT = 8, SPOT_APPARENT = 20;
/** Smooth hand-over from the extended (Crumey area) margin to the point-source margin for tiny apparent sizes:
 *  pure point below POINT_FULL′ apparent, pure extended above POINT_NONE′, log-linear between. */
const POINT_FULL = 4, POINT_NONE = 12;

/** Richness bonus on the cluster resolution margin, per dex of members above LM − 0.5 (beyond the first 5). */
export const CLUSTER_RICHNESS = 0.3;

/** Double stars (spec §7.3). */
/** Apparent separation (arcsec at the eye) at which a steady, bright, equal pair is *just* split (split ratio 1).
 *  Calibrated rather than the spec's 240″: with hand-held shake (×1.25) a 10x50 then just splits 20″, close to the
 *  Astronomical League's ~24″ for 4th-mag pairs, and Albireo (34″, Δm 2) is a clear split at 10x, easy at 14x. */
const RHO_EYE = 160;
/** Unequal-pair factor per magnitude of Δm (spec heuristic 0.25 was far too strict against field reports). */
const DM_FACTOR = 0.1;
const SEEING_FLOOR = 2;

/** Counterfactual "ideal" conditions (spec §8.2). */
export const IDEAL = { darkSiteSqm: 21.8, crispAerosol: 0.3, alt: 75, sunAlt: -18 } as const;

// ───────────────────────────── units & atmosphere ─────────────────────────────

/** mag/arcsec² → cd/m² (Crumey §1.3). */
export const muToCd = (mu: number) => 10 ** (-0.4 * (mu - 12.58));
/** cd/m² → mag/arcsec². */
export const cdToMu = (b: number) => 12.58 - 2.5 * Math.log10(b);
const NL_TO_CD = 3.183e-6;
const luxToMag = (lux: number) => -2.5 * Math.log10(lux) - 13.99;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Extinction airmass (Rozenberg 1966): X = 1 / (cos z + 0.025·e^(−11 cos z)); 40 at the horizon. */
export function airmass(alt: number): number {
  const c = Math.cos((90 - clamp(alt, 0, 90)) * RAD);
  return 1 / (c + 0.025 * Math.exp(-11 * c));
}
/** Scattering airmass for sky glow (K&S eq 3). */
export function scatteringAirmass(alt: number): number {
  const s = Math.sin((90 - clamp(alt, 0, 90)) * RAD);
  return (1 - 0.96 * s * s) ** -0.5;
}
/** V-band extinction coefficient (mag/airmass) by site elevation and aerosol scale (Green 1992, ICQ 14:55).
 *  aerosolScale 1 = average night; see AEROSOL_SCALE. Sea level: 0.28; 1 km: 0.21; 2.2 km: 0.15. */
export function extinctionCoefficient(elevationM: number, aerosolScale = 1): number {
  const h = Math.max(0, elevationM) / 1000;
  return 0.1451 * Math.exp(-h / 7.996) + 0.12 * Math.exp(-h / 1.5) * aerosolScale + 0.016;
}

/** Great-circle separation in degrees. */
function separation(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const c = Math.sin(dec1 * RAD) * Math.sin(dec2 * RAD) + Math.cos(dec1 * RAD) * Math.cos(dec2 * RAD) * Math.cos((ra1 - ra2) * RAD);
  return Math.acos(clamp(c, -1, 1)) / RAD;
}

// ───────────────────────────── sky brightness ─────────────────────────────

/**
 * Twilight brightening of a dark (21.9) sky, in magnitudes (heuristic): 0 at Sun −18°, rising linearly to 2.5 mag at
 * −12° (end of nautical twilight, sky ≈ 19.4 mag/arcsec²), then 1.2 mag per degree above −12° (≈ 12 at −6°).
 * Added as luminance, so a light-polluted sky is brightened by less in magnitudes.
 */
export function twilightBrightening(sunAlt: number | undefined): number {
  if (sunAlt === undefined || sunAlt <= -18) return 0;
  if (sunAlt <= -12) return (2.5 * (sunAlt + 18)) / 6;
  return 2.5 + 1.2 * (sunAlt + 12);
}

export interface SkyBreakdown {
  /** Sky at the target with everything, mag/arcsec². */
  mu: number;
  /** Without the Moon (still with twilight). */
  muNoMoon: number;
  /** Mag the Moon brightens the sky here (≥ 0). */
  moonDelta: number;
  /** Mag twilight brightens the sky here (≥ 0). */
  twilightDelta: number;
  /** Moon–target separation (deg), when a Moon is given and up. */
  moonSeparation: number | null;
}

/**
 * Sky brightness toward the target:
 * - natural part (≤ 21.9 at the zenith): K&S eq 2, B0 = B_zen·10^(−0.4k(Xs−1))·Xs;
 * - artificial part (zenith brighter than 21.9): ×Xs^1.5 toward the horizon and ×(k / k_average) for haze scattering
 *   (clamped 0.6–3; normalised to an average night at that elevation, so the zenith matches the user's SQM then);
 * - Moon: Krisciunas & Schaefer 1991 eqs 15, 19–21 (tapered over Moon altitude −2…0°);
 * - twilight: see twilightBrightening, scaled by Xs like the natural sky.
 */
export function skyBrightnessBreakdown(sky: SkyInputs, alt: number, target?: { ra: number; dec: number }): SkyBreakdown {
  const k = sky.extinctionK, xs = scatteringAirmass(alt);
  const bZen = muToCd(sky.zenithSqm), bNatZen = Math.min(bZen, muToCd(NATURAL_SKY_MU)), bArtZen = bZen - bNatZen;
  const hazeFactor = clamp(k / extinctionCoefficient(sky.elevationM, 1), 0.6, 3);
  const bNat = bNatZen * 10 ** (-0.4 * k * (xs - 1)) * xs;
  const bArt = bArtZen * xs ** 1.5 * hazeFactor;
  const tw = twilightBrightening(sky.sunAlt);
  const bTw = tw > 0 ? muToCd(NATURAL_SKY_MU) * (10 ** (0.4 * tw) - 1) * xs : 0;
  const base = bNat + bArt + bTw;

  let bMoon = 0, sep: number | null = null;
  const moon = sky.moon;
  if (moon && moon.alt > -2 && target && alt > 0) {
    sep = separation(target.ra, target.dec, moon.ra, moon.dec);
    const rho = Math.max(sep, 0.5);
    const alpha = Number.isFinite(moon.phaseAngle)
      ? Math.abs(moon.phaseAngle)
      : Math.acos(clamp(2 * moon.illumination - 1, -1, 1)) / RAD;
    const iStar = 10 ** (-0.4 * (3.84 + 0.026 * alpha + 4e-9 * alpha ** 4));
    const cos2 = Math.cos(rho * RAD) ** 2;
    const f = 10 ** 5.36 * (1.06 + cos2) + (rho >= 10 ? 10 ** (6.15 - rho / 40) : 6.2e7 / (rho * rho));
    const xm = scatteringAirmass(Math.max(moon.alt, 0));
    const taper = clamp((moon.alt + 2) / 2, 0, 1);
    const nL = f * iStar * 10 ** (-0.4 * k * xm) * (1 - 10 ** (-0.4 * k * xs)) * taper;
    bMoon = nL * NL_TO_CD;
  }
  const mu = cdToMu(base + bMoon), muNoMoon = cdToMu(base);
  const muNoTw = cdToMu(bNat + bArt);
  return { mu, muNoMoon, moonDelta: muNoMoon - mu, twilightDelta: muNoTw - muNoMoon, moonSeparation: sep };
}

/** Sky brightness (mag/arcsec²) toward a target at `alt`, including horizon brightening, Moon and twilight. */
export function skyBrightnessAt(sky: SkyInputs, alt: number, target?: { ra: number; dec: number }): number {
  return skyBrightnessBreakdown(sky, alt, target).mu;
}

// ───────────────────────────── instrument & eye ─────────────────────────────

export interface Steadiness {
  /** Limiting-magnitude penalty ΔS (mag); F_S = 10^(0.4·ΔS) multiplies the contrast threshold. */
  mag: number;
  /** Multiplier on the separation needed to split a double. */
  resolution: number;
}

/**
 * Hand-shake heuristic (spec §3.1; BirdForum Canon 10x42 IS bar test, Zarenski): tripod 0 / 1.0;
 * image-stabilised 0.1 mag / ×1.10; free hand-held 0.3 + 0.05·max(0, M−7) mag (10x: 0.45) and
 * ×(1.25 + 0.04·(M−10)) resolution (floored at 1.1). The spec's ×1.75 comes from a fine bar-target test; for two
 * bright points the eye integrates through the shake, and that factor made easy doubles (Albireo) unsplittable.
 */
export function steadinessPenalty(support: Support, magnification: number): Steadiness {
  if (support === 'tripod') return { mag: 0, resolution: 1 };
  if (support === 'stabilized') return { mag: 0.1, resolution: 1.1 };
  return {
    mag: 0.3 + 0.05 * Math.max(0, magnification - 7),
    resolution: Math.max(1.1, 1.25 + 0.04 * (magnification - 10)),
  };
}

/**
 * Reference pupil (mm) of Crumey's naked-eye calibration. Crumey writes his binocular relations (eqs 66–68) with the
 * observer's own pupil p, which makes a *smaller* pupil look *better* (B_a and the (δmax/D)² factor both shrink).
 * Physically the eye's threshold is a function of retinal illuminance, so we keep the calibration at a fixed
 * reference pupil and let the observer's pupil act only where it clips the beam: the light entering the eye comes
 * through min(exit pupil, p_obs), i.e. an effective aperture D_eff = M·min(D/M, p_obs). A smaller pupil can therefore
 * only lose light (never improve a result). With p_obs = P_REF this is exactly Crumey's form (spec §9 numbers).
 */
export const P_REF = 6;
const beam = (optics: Optics, observer: Observer) => Math.min(optics.aperture / optics.magnification, observer.pupil);

/** Eyepiece background luminance B_a (Crumey eq 66 with the reference pupil), clamped at the zero-background cut-off. */
function eyepieceBackground(bSky: number, optics: Optics, observer: Observer): number {
  return Math.max((beam(optics, observer) / P_REF) ** 2 * bSky * optics.transmission, B_MIN);
}
/** Bright-sky penalty in mag (heuristic, spec §6.2). */
const brightSkyPenalty = (muSky: number) => BRIGHT_SKY_PENALTY * Math.max(0, BRIGHT_SKY_PIVOT - muSky);

/**
 * Faintest star (catalogue V) visible through the binocular (Crumey eqs 65–68): includes extinction `extinctionMag`
 * (= k·X), the steadiness factor of `optics.support` and the bright-sky penalty (see P_REF for the pupil). Reproduces 10x50, p 6, F 2, tripod,
 * µ 21.34, kX 0.29 → 10.35.
 */
export function stellarLimit(muSky: number, optics: Optics, observer: Observer = DEFAULT_OBSERVER, extinctionMag = 0): number {
  const steady = steadinessPenalty(optics.support, optics.magnification);
  const phi = observer.fieldFactor * 10 ** (0.4 * steady.mag);
  const ba = eyepieceBackground(muToCd(muSky), optics, observer);
  const dIa = phi * (R1 * ba ** 0.25 + R2 * ba ** 0.5) ** 2;
  const dEff = optics.magnification * beam(optics, observer); // effective aperture, mm
  const dI = (P_REF / dEff) ** 2 * dIa / optics.transmission;
  return luxToMag(dI) - extinctionMag - brightSkyPenalty(muSky);
}

/** Crumey eq 77 contrast threshold for apparent solid angle `aa` (sr) on eyepiece background `ba`. */
function contrastThreshold(ba: number, aa: number, phi: number) {
  const x = Math.max(ba, B_MIN) ** -0.25;
  const r = (R1 * x + R2) ** 2, cInf = K1 * x + K2;
  return { cth: phi * ((r / aa) ** Q + cInf ** Q) ** (1 / Q), ricco: r / cInf };
}

interface ExtendedResult {
  margin: number;
  /** Apparent solid angle vs the eyepiece Ricco area: < 0.3 point-like, > 3 surface-brightness regime. */
  riccoRatio: number;
}

/** Steadiness exponent for extended objects: full F_S up to 30′ apparent, √F_S beyond 2° (log-linear between). */
function steadinessWeight(apparentArcmin: number) {
  const t = clamp(Math.log(apparentArcmin / 30) / Math.log(120 / 30), 0, 1);
  return 1 - 0.5 * t;
}

function extendedMargin(mag: number, a: number, b: number, muSky: number, kX: number, optics: Optics, observer: Observer): ExtendedResult {
  const M = optics.magnification;
  const area = (Math.PI / 4) * a * b; // arcmin²
  const muObj = mag + kX + 2.5 * Math.log10(area * 3600);
  const cObj = 10 ** (-0.4 * (muObj - muSky));
  const ba = eyepieceBackground(muToCd(muSky), optics, observer);
  const aa = (area * M * M) / ARCMIN_PER_RAD ** 2;
  const steady = steadinessPenalty(optics.support, M);
  const phi = observer.fieldFactor * 10 ** (0.4 * steady.mag * steadinessWeight(a * M));
  const { cth, ricco } = contrastThreshold(ba, aa, phi);
  return { margin: Math.log10(cObj / cth) - 0.4 * brightSkyPenalty(muSky), riccoRatio: aa / ricco };
}

// ───────────────────────────── per-kind evaluation ─────────────────────────────

/** Everything one evaluation knows; estimateVisibility runs it for tonight and for each counterfactual. */
interface Evaluation {
  margin: number;
  appearance: string;
  lm: number;
  mu: number;
  sky: SkyBreakdown;
  kX: number;
  steadyMag: number;
  // extended / cluster glow
  apparentMajor?: number;
  riccoRatio?: number;
  coreOnly?: boolean;
  // double
  split?: number;
  rhoReq?: number;
  rhoReqEqual?: number;
  rhoReqTripod?: number;
  splitMargin?: number;
  companionMargin?: number;
  // cluster
  dR?: number;
  brightest?: number;
  glowMargin?: number;
  resMargin?: number;
  crowded?: boolean;
}

/** 0.4·(LM − m): margin of a point source, in the same log-contrast units as the extended margin. */
const pointMargin = (lm: number, m: number) => 0.4 * (lm - m);

/** Split ratio ρ/ρ_req → margin on the §7.3 bins: 0.8 → −0.15, 1.0 → 0.15, 1.3 → 0.4, 2 → 0.8, then +0.5 per doubling. */
function splitToMargin(split: number): number {
  const pts: [number, number][] = [[0.4, -0.8], [0.8, -0.15], [1.0, 0.15], [1.3, 0.4], [2.0, 0.8]];
  if (split <= pts[0][0]) return -0.8 - (pts[0][0] - split) * 2;
  if (split >= 2) return 0.8 + 0.5 * Math.log2(split / 2);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (split <= x1) return y0 + ((split - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 0.8;
}

/** Glow margin for an extended object, with the point-source blend and (galaxies/globulars) the core variant. */
function glowMargin(t: VisibilityTarget, mag: number, lm: number, mu: number, kX: number, optics: Optics, observer: Observer, fovArcmin: number) {
  const a0 = t.majorArcmin!, b0 = t.minorArcmin ?? a0;
  // Only the part inside the field can be compared with the surrounding sky.
  const a = Math.min(a0, fovArcmin), b = Math.min(b0, fovArcmin);
  const whole = extendedMargin(mag, a, b, mu, kX, optics, observer);
  let best = whole, coreOnly = false, aUsed = a;
  // Core variants: the generic 0.3·extent at m + 1 for concentrated classes, and an explicit catalogued core.
  const cores: { a: number; b: number; m: number }[] = [];
  if (CORE_CLASSES.has(t.objectClass)) cores.push({ a: a0 * CORE_SCALE, b: b0 * CORE_SCALE, m: mag + CORE_MAG });
  if (t.core) cores.push({ a: t.core.majorArcmin, b: t.core.minorArcmin, m: t.core.mag + (mag - t.mag) });
  for (const c of cores) {
    const core = extendedMargin(c.m, c.a, c.b, mu, kX, optics, observer);
    // "Only the core shows" when a core variant wins and the full object would be hard to see.
    if (core.margin > best.margin) { best = core; coreOnly = whole.margin < LEVEL_THRESHOLDS[2]; aUsed = c.a; }
  }
  const apparent = aUsed * optics.magnification;
  const w = clamp(Math.log(POINT_NONE / apparent) / Math.log(POINT_NONE / POINT_FULL), 0, 1);
  const margin = w * pointMargin(lm, mag) + (1 - w) * best.margin;
  return { margin, riccoRatio: best.riccoRatio, coreOnly, apparentMajor: a0 * optics.magnification };
}

/** Brightest-member estimate when the catalogue has none: globulars ≈ m + 5.5 (capped 15), others ≈ m + 2.5. */
export function estimateBrightestStar(t: Pick<VisibilityTarget, 'mag' | 'objectClass' | 'brightestStarMag'>): number {
  if (t.brightestStarMag !== undefined) return t.brightestStarMag;
  return t.objectClass === 'globular' ? Math.min(t.mag + 5.5, 15) : t.mag + 2.5;
}

function levelOf(margin: number): VisibilityLevel {
  const i = LEVEL_THRESHOLDS.findIndex((th) => margin >= th);
  return (i < 0 ? 4 : i) as VisibilityLevel;
}

const EXTENDED_TEXT = [
  'An obvious glow — easy to see',
  'A clear glow',
  'A faint glow — easier if you look slightly to one side of it',
  'Barely there — you may glimpse it from the corner of your eye',
  'Not visible tonight',
];
const SPOT_TEXT = [
  'A small, obvious fuzzy spot',
  'A small fuzzy spot',
  'A faint fuzzy spot — easier if you look slightly to one side of it',
  'A tiny smudge you may glimpse from the corner of your eye',
  'Not visible tonight',
];
const STAR_TEXT = [
  'An easy, steady point of light',
  'A clearly visible star',
  'A faint star, but you can see it looking straight at it',
  'Barely visible — look slightly to one side of it',
  'Too faint to see tonight',
];

function evaluate(t: VisibilityTarget, optics: Optics, sky: SkyInputs, alt: number, observer: Observer): Evaluation {
  const X = airmass(alt), kX = sky.extinctionK * X;
  const sb = skyBrightnessBreakdown(sky, alt, t);
  const mu = sb.mu;
  const lm = stellarLimit(mu, optics, observer, kX);
  const steady = steadinessPenalty(optics.support, optics.magnification);
  const base = { lm, mu, sky: sb, kX, steadyMag: steady.mag };
  const M = optics.magnification, fovArcmin = optics.fov * 60;
  const colour = (t.objectClass && NEBULA_COLOUR_MAG[t.objectClass]) ?? 0;

  if (t.kind === 'star' || ((t.kind === 'extended' || t.kind === 'cluster') && !t.majorArcmin)) {
    const margin = pointMargin(lm, t.mag + colour);
    const text = t.kind === 'star' ? STAR_TEXT[levelOf(margin)] : levelOf(margin) <= 2 ? `Looks like a star at ${M}×` : EXTENDED_TEXT[levelOf(margin)];
    return { ...base, margin, appearance: text };
  }

  if (t.kind === 'extended' && t.objectClass === 'dark') {
    // Dark nebulae have no magnitude: visibility is the contrast of a starless patch against a rich background,
    // which needs a dark sky (heuristic: Fair at µ 21.1, Difficult near 20.5, gone below ~19.9).
    const margin = 0.4 * (mu - 20.5);
    return { ...base, margin, appearance: levelOf(margin) <= 3 ? 'A dark, starless patch against the Milky Way' : 'Not visible tonight' };
  }

  if (t.kind === 'double') {
    const m1 = Math.min(t.mag, t.mag2 ?? t.mag), m2 = Math.max(t.mag, t.mag2 ?? t.mag);
    const rho = t.sepArcsec ?? 0;
    const dm = Math.min(m2 - m1, 4);
    const fDm = 1 + DM_FACTOR * dm;
    const fFaint = 1 + 0.5 * Math.max(0, m2 - (lm - 2)); // lm is already extinction-corrected
    const floor = Math.max(116 / optics.aperture, SEEING_FLOOR);
    const rhoReq = Math.max((RHO_EYE * fDm * fFaint * steady.resolution) / M, floor);
    const rhoReqEqual = Math.max((RHO_EYE * fFaint * steady.resolution) / M, floor);
    const rhoReqTripod = (RHO_EYE * fDm * fFaint) / M;
    const split = rho / rhoReq;
    const splitMargin = splitToMargin(split);
    const companionMargin = pointMargin(lm - 0.5, m2);
    const primaryMargin = pointMargin(lm, m1);
    const margin = Math.min(splitMargin, companionMargin, primaryMargin);
    let appearance: string;
    if (primaryMargin < -0.15) appearance = 'Too faint to see tonight';
    else if (companionMargin < Math.min(splitMargin, -0.15)) appearance = 'Only the brighter star shows; the companion is too faint tonight';
    else if (companionMargin < Math.min(splitMargin, LEVEL_THRESHOLDS[2])) appearance = split >= 1 ? 'Split, but the faint companion is at the edge of visibility' : 'The faint companion is lost in the glare of its primary';
    else if (split >= 2) appearance = 'Splits cleanly into two stars';
    else if (split >= 1.3) appearance = 'A clear split into two stars';
    else if (split >= 1) appearance = 'A tight split — needs a steady view';
    else if (split >= 0.8) appearance = 'Looks elongated or notched, not cleanly split';
    else appearance = 'Looks like a single star';
    if (rho > 0.3 * optics.fov * 3600) appearance += '; the pair is too wide to fit in one field';
    return { ...base, margin, appearance, split, rhoReq, rhoReqEqual, rhoReqTripod, splitMargin, companionMargin };
  }

  // extended or cluster with a size
  const glow = glowMargin(t, t.mag + colour, lm, mu, kX, optics, observer, fovArcmin);
  const tooBig = t.majorArcmin! > 0.9 * fovArcmin;
  const sizeNote = tooBig ? '; it fills the field, so you only see part of it' : '';

  if (t.kind === 'extended') {
    const lvl = levelOf(glow.margin);
    let text = EXTENDED_TEXT[lvl];
    if (lvl <= 3) {
      if (glow.apparentMajor < STELLAR_APPARENT) text = lvl <= 2 ? `Looks like a star at ${M}×` : `A faint star-like point at ${M}× — glimpse it from the corner of your eye`;
      else if (glow.apparentMajor < SPOT_APPARENT) text = SPOT_TEXT[lvl];
      else if (glow.coreOnly && lvl >= 1) text += '; only the bright core shows';
      text += sizeNote;
    }
    return { ...base, margin: glow.margin, appearance: text, apparentMajor: glow.apparentMajor, riccoRatio: glow.riccoRatio, coreOnly: glow.coreOnly };
  }

  // cluster: overall glow + resolution depth + crowding
  const brightest = estimateBrightestStar(t);
  const dR = lm - brightest;
  let resMargin = pointMargin(lm, brightest);
  // Crowding (spec §7.4): ~5 members at brightestStarMag, luminosity function slope 0.3 dex/mag, capped at memberCount.
  const nVis = Math.min(t.memberCount ?? Infinity, 5 * 10 ** (0.3 * (lm - 0.5 - brightest)));
  const a = t.majorArcmin!, b = t.minorArcmin ?? a;
  const spacing = nVis >= 5 ? M * Math.sqrt(((Math.PI / 4) * a * b) / nVis) : Infinity;
  const crowded = dR > 0 && spacing < 2.5;
  if (crowded) resMargin -= 0.4;
  // Richness (heuristic, calibrated against curator grades): a field with many members above the limit is easier to
  // notice than one star at m_b (probability summation over many near-threshold stars).
  if (dR > 0 && nVis > 5) resMargin += CLUSTER_RICHNESS * Math.log10(nVis / 5);
  const margin = Math.max(glow.margin, resMargin);
  let appearance: string;
  if (margin < LEVEL_THRESHOLDS[3]) appearance = 'Not visible tonight';
  else if (dR > 2.5) appearance = crowded ? 'Many stars, packed into a grainy glow' : 'Resolves into many stars';
  else if (dR > 1) appearance = crowded ? 'A grainy glow with a few stars showing' : 'Some of its stars sparkle in a soft glow';
  else if (dR > 0) appearance = 'A few stars sparkle at the edge of the glow';
  else {
    const gl = levelOf(glow.margin);
    const small = glow.apparentMajor < SPOT_APPARENT;
    appearance = gl <= 1
      ? (t.objectClass === 'globular' ? (small ? 'A fuzzy star — too far to see its separate stars' : 'A bright fuzzy ball — its separate stars are too faint') : 'A soft glow — its separate stars are too faint')
      : gl === 2 ? 'A faint soft glow' : 'A faint soft glow — glimpse it from the corner of your eye';
  }
  appearance += sizeNote;
  return {
    ...base, margin, appearance, apparentMajor: glow.apparentMajor, riccoRatio: glow.riccoRatio, coreOnly: glow.coreOnly,
    dR, brightest, glowMargin: glow.margin, resMargin, crowded,
  };
}

// ───────────────────────────── limitations ─────────────────────────────

const fmt1 = (x: number) => x.toFixed(1);
/** A magnitude difference as a plain brightness ratio: "about 8×" (1.6 → "about 1.6×"). */
const times = (dMag: number) => { const f = 10 ** (0.4 * Math.abs(dMag)); return `about ${f < 3 ? f.toFixed(1) : Math.round(f)}×`; };
/** Share of the light lost to `dMag` of dimming, as a rounded percentage. */
const lostPct = (dMag: number) => Math.round((1 - 10 ** (-0.4 * Math.max(0, dMag))) * 100);
/** Plain name for a zenith sky brightness (mirrors the SKY_PRESETS cues in ./conditions.ts). */
const skyName = (sqm: number) => sqm < 18 ? 'city' : sqm < 19 ? 'bright town' : sqm < 20 ? 'suburban' : sqm < 21 ? 'edge-of-town' : 'country';
/** Angular size in words: "1.5°" or "40′". */
const sizeWords = (arcmin: number) => arcmin >= 60 ? `${fmt1(arcmin / 60)}°` : `${Math.round(arcmin)}′`;
const MIN_GAIN = 0.1;

function conditionLimits(t: VisibilityTarget, optics: Optics, sky: SkyInputs, alt: number, obs: Observer, now: Evaluation): Limitation[] {
  const out: Limitation[] = [];
  const gainOf = (e: Evaluation) => Math.max(0, e.margin - now.margin);
  const push = (factor: LimitFactor, e: Evaluation, text: string) => {
    const gain = gainOf(e);
    if (gain >= MIN_GAIN) out.push({ factor, gain, text });
  };
  if (sky.moon && now.sky.moonDelta > 0) {
    const e = evaluate(t, optics, { ...sky, moon: null }, alt, obs);
    const pct = Math.round(sky.moon.illumination * 100), sep = Math.round(now.sky.moonSeparation ?? 0);
    push('moon', e, `Moonlight: the ${pct}% lit Moon, ${sep}° away, makes the sky here ${times(now.sky.moonDelta)} brighter.`);
  }
  if (sky.zenithSqm < IDEAL.darkSiteSqm) {
    const e = evaluate(t, optics, { ...sky, zenithSqm: IDEAL.darkSiteSqm }, alt, obs);
    push('light-pollution', e, `Light pollution: your ${skyName(sky.zenithSqm)} sky is ${times(IDEAL.darkSiteSqm - sky.zenithSqm)} brighter than a dark site.`);
  }
  const crispK = extinctionCoefficient(sky.elevationM, IDEAL.crispAerosol);
  if (sky.extinctionK > crispK) {
    const e = evaluate(t, optics, { ...sky, extinctionK: crispK }, alt, obs);
    push('haze', e, `Haze: the air is murkier than on a crisp night, so it loses about ${lostPct((sky.extinctionK - crispK) * airmass(alt))}% more of its light.`);
  }
  if (alt < IDEAL.alt) {
    const e = evaluate(t, optics, sky, IDEAL.alt, obs);
    push('altitude', e, `${alt < 30 ? 'Low in the sky' : 'Not at its highest'} (${Math.round(alt)}° up): it shines through more air, which takes about ${lostPct(now.kX)}% of its light. It looks better when higher.`);
  }
  if (sky.sunAlt !== undefined && sky.sunAlt > IDEAL.sunAlt) {
    const e = evaluate(t, optics, { ...sky, sunAlt: undefined }, alt, obs);
    push('twilight', e, sky.sunAlt > -0.833 ? 'Daylight: the Sun is up, so only the brightest stars show.' : `Twilight: the Sun is only ${Math.round(-sky.sunAlt)}° below the horizon, so the sky is still ${times(now.sky.twilightDelta)} brighter than at full dark.`);
  }
  if (optics.support !== 'tripod') {
    const e = evaluate(t, { ...optics, support: 'tripod' }, sky, alt, obs);
    const what = optics.support === 'handheld' ? 'Hand-shake' : 'Residual shake';
    push('steadiness', e, `${what} hides the faintest stars${t.kind === 'double' ? ' and blurs close pairs' : ''}; brace your elbows or use a tripod.`);
  }
  return out;
}

function intrinsicLimits(t: VisibilityTarget, optics: Optics, now: Evaluation, ideal: Evaluation): Limitation[] {
  const out: Limitation[] = [];
  const M = optics.magnification, D = optics.aperture;
  const shortfall = Math.max(0, LEVEL_THRESHOLDS[1] - ideal.margin);
  const notGoodIdeal = ideal.margin < LEVEL_THRESHOLDS[1];

  if (t.kind === 'star') {
    if (notGoodIdeal) out.push({ factor: 'faint', gain: shortfall, text: `At magnitude ${fmt1(t.mag)} it is close to the faintest ${D} mm binoculars can show, even on a perfect night.` });
    return out;
  }
  if (t.kind === 'double') {
    const splitBinding = (now.splitMargin ?? 0) <= (now.companionMargin ?? 0);
    if (splitBinding && (now.split ?? 0) < 1.3) {
      const rho = t.sepArcsec ?? 0;
      // Magnification for a clean split (ratio 1.3) on a steady mount; shake grows with M, so quote it for a tripod.
      const needM = Math.ceil((M * (now.rhoReqTripod ?? 0) * 1.3) / Math.max(rho, 0.1));
      const unequal = (now.rhoReqEqual ?? 0) <= rho && (now.rhoReq ?? 0) > rho;
      const gain = Math.max(0, LEVEL_THRESHOLDS[1] - (ideal.splitMargin ?? ideal.margin));
      if (rho < 116 / D) out.push({ factor: 'too-close', gain, text: `The two stars are only ${fmt1(rho)}″ apart — closer than ${D} mm binoculars can separate.` });
      else if (unequal) out.push({ factor: 'unequal-pair', gain, text: `One star is ${times((t.mag2 ?? t.mag) - t.mag)} fainter than the other and hides in its glare at ${M}×; about ${needM}× on a tripod would show both.` });
      else if (needM <= M) out.push({ factor: 'too-close', gain, text: `A tight pair at ${M}×: it splits cleanly only when held rock-steady, e.g. on a tripod.` });
      else out.push({ factor: 'too-close', gain, text: `Too close together to split at ${M}×; about ${needM}× on a tripod would separate the two stars.` });
    }
    if ((ideal.companionMargin ?? 1) < LEVEL_THRESHOLDS[1]) out.push({ factor: 'faint', gain: Math.max(0, LEVEL_THRESHOLDS[1] - (ideal.companionMargin ?? 0)), text: `The fainter star (magnitude ${fmt1(t.mag2 ?? t.mag)}) is close to the faintest ${D} mm binoculars can show.` });
    return out;
  }

  const fov = optics.fov * 60;
  if (t.majorArcmin && t.majorArcmin > 0.9 * fov)
    out.push({ factor: 'larger-than-field', gain: 0, text: `At ${sizeWords(t.majorArcmin)} across it is bigger than your ${fmt1(optics.fov)}° view — sweep around to take it in.` });
  if (now.apparentMajor !== undefined && now.apparentMajor < STELLAR_APPARENT && t.objectClass !== 'globular')
    out.push({ factor: 'too-small', gain: 0, text: `So small that at ${M}× it looks like a star.` });

  if (t.kind === 'cluster' && now.dR !== undefined && now.dR < 1)
    out.push({
      factor: 'unresolved-stars', gain: 0,
      text: now.dR < 0 ? 'Its stars are too faint to pick out tonight, so it shows as a glow.' : 'Its brightest stars are right at the limit tonight, so only a few sparkle in the glow.',
    });

  const glowIdeal = t.kind === 'cluster' ? (ideal.glowMargin ?? ideal.margin) : ideal.margin;
  if (notGoodIdeal && glowIdeal < LEVEL_THRESHOLDS[1]) {
    const pointLike = (ideal.riccoRatio ?? 0) < 1 || !t.majorArcmin;
    if (pointLike) out.push({ factor: 'faint', gain: shortfall, text: `Too faint overall for ${D} mm binoculars, even on a perfect night.` });
    else {
      const a = t.majorArcmin!, b = t.minorArcmin ?? a;
      const sbObj = t.mag + 2.5 * Math.log10((Math.PI / 4) * a * b * 3600);
      out.push({ factor: 'low-surface-brightness', gain: shortfall, text: sbObj > now.mu ? `Its light is spread thin — each patch is ${times(sbObj - now.mu)} fainter than the sky around it — so it needs a really dark sky.` : 'Its light is spread over a large area, so it needs a really dark sky.' });
    }
  }
  return out;
}

// ───────────────────────────── public entry ─────────────────────────────

/** Highest score a lone single star can reach ("Good" territory): ranking lists sorted by score should put rich,
 *  rewarding objects (M45, M31, M44, the Double Cluster, M42, M13) above a merely bright single star. The level is
 *  unaffected — a 2nd-magnitude star is still "Excellent" to see. */
export const SINGLE_STAR_SCORE_CAP = 75;

/**
 * Score 0..100, monotone in the margin and still discriminating above Excellent:
 * margin < 0: 50 + 50·m (0 at m ≤ −1); 0…1: 50 + 40·m (Good 0.4 → 66, Excellent 0.8 → 82);
 * > 1: 90 + 10·(1 − e^−(m−1)/1.5) (approaches 100). Single stars are capped at SINGLE_STAR_SCORE_CAP.
 */
export function visibilityScore(margin: number, kind: VisibilityKind): number {
  const s = margin < 0 ? Math.max(0, 50 + 50 * margin) : margin <= 1 ? 50 + 40 * margin : 90 + 10 * (1 - Math.exp(-(margin - 1) / 1.5));
  return Math.round(kind === 'star' ? Math.min(s, SINGLE_STAR_SCORE_CAP) : s);
}

/**
 * Visibility of `target` through `optics` under `sky`, with the target at altitude `alt` (degrees).
 * Score: see visibilityScore.
 */
export function estimateVisibility(target: VisibilityTarget, optics: Optics, sky: SkyInputs, alt: number, observer: Observer = DEFAULT_OBSERVER): VisibilityEstimate {
  const kind: VisibilityKind = target.kind;
  if (alt <= 0) {
    const h = evaluate(target, optics, sky, 0, observer);
    return {
      level: 4, label: VISIBILITY_LABELS[4], margin: -2, score: 0, kind, appearance: 'Below the horizon',
      limitingMag: h.lm, skyAtTarget: h.mu, extinctionMag: h.kX,
      limits: [{ factor: 'altitude', gain: 2, text: 'Below the horizon at this time.' }],
    };
  }
  const now = evaluate(target, optics, sky, alt, observer);
  const idealSky: SkyInputs = {
    ...sky,
    moon: null,
    sunAlt: undefined,
    zenithSqm: Math.max(sky.zenithSqm, IDEAL.darkSiteSqm),
    extinctionK: Math.min(sky.extinctionK, extinctionCoefficient(sky.elevationM, IDEAL.crispAerosol)),
  };
  const ideal = evaluate(target, { ...optics, support: 'tripod' }, idealSky, Math.max(alt, IDEAL.alt), observer);
  const conditions = conditionLimits(target, optics, sky, alt, observer, now);
  const intrinsic = intrinsicLimits(target, optics, now, ideal);
  const order = (l: Limitation) => conditions.includes(l) ? 0 : 1;
  const limits = [...conditions, ...intrinsic].sort((a, b) => b.gain - a.gain || order(a) - order(b));
  const level = levelOf(now.margin);
  return {
    level,
    label: VISIBILITY_LABELS[level],
    margin: now.margin,
    score: visibilityScore(now.margin, kind),
    kind,
    appearance: now.appearance,
    limitingMag: now.lm,
    skyAtTarget: now.mu,
    extinctionMag: now.kX,
    limits,
  };
}
