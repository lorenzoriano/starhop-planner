import * as Astro from "astronomy-engine";
import {
  eqToHorizontal,
  type UnifiedTarget,
  type ObservingMode,
} from "./astronomy";
import { binocularAssessment, type BinocularProfile, type FitRating } from "./binocular-assessment";
import { moonIllumination, moonState, type MoonState } from "./moon";
import {
  MIN_ALT, TWILIGHT, darkEnough, isStellarCategory, minAltitude, moonCategoryOfCategory, moonVerdict, plannerMoonWeight,
  type MoonVerdict, type VisibilityRule,
} from "./sky-feasibility";

export interface ObjectGuide {
  story: string;
  lookFor: string;
  equipment: string;
  binocular: boolean;
}
export const OBJECT_GUIDES: Record<string, ObjectGuide> = {
  M31: {
    story:
      "The light reaching Earth tonight left Andromeda about 2.5 million years ago. This is a whole galaxy, home to roughly a trillion stars.",
    lookFor:
      "A soft oval glow with a brighter center. Find μ Andromedae from brighter Mirach, then sweep onward to the galaxy. A route starting at μ And skips that naked-eye landmark step. Dark skies reveal more of its enormous disk.",
    equipment: "Binoculars · low power telescope",
    binocular: true,
  },
  M45: {
    story:
      "The Seven Sisters are a young family of stars, about 440 light years away. Most formed together within the last 100 million years.",
    lookFor:
      "A tiny dipper of blue white stars. A wide binocular field frames the entire cluster; its reflection nebulosity is much harder to see.",
    equipment: "Best in binoculars",
    binocular: true,
  },
  M42: {
    story:
      "Inside Orion’s sword is a stellar nursery. New stars are forming in this glowing cloud, about 1,350 light years from Earth.",
    lookFor:
      "A pale fan of light around the middle star of the sword. A small telescope shows the four stars of the Trapezium at its heart.",
    equipment: "Binoculars · small telescope",
    binocular: true,
  },
  M13: {
    story:
      "Hundreds of thousands of ancient stars crowd this globular cluster. Many are more than twice the age of our Sun.",
    lookFor:
      "A round, fuzzy ball between the western stars of Hercules’ keystone. A telescope begins to resolve individual stars around its edge.",
    equipment: "Binoculars to find · telescope for detail",
    binocular: true,
  },
  M57: {
    story:
      "A dying star shed its outer layers to make this smoke ring in Lyra. Our Sun may end its life in a similar way.",
    lookFor:
      "A small gray ring between Sheliak and Sulafat. Use a telescope and moderate magnification; binoculars rarely reveal its shape.",
    equipment: "Small telescope · moderate power",
    binocular: false,
  },
  M81: {
    story:
      "Bode’s Galaxy is a spiral island of stars about 12 million light years away. Nearby M82 makes a rewarding companion in the same wide field.",
    lookFor:
      "A faint oval patch. Averted vision and a dark sky help; a wide, low power telescope field can show both M81 and M82.",
    equipment: "Dark skies · binoculars or telescope",
    binocular: true,
  },
  M51: {
    story:
      "The Whirlpool is interacting with a smaller companion galaxy. Their gravitational dance is shaping its spiral arms.",
    lookFor:
      "Two faint glows under a dark sky. Spiral arms need a larger telescope and excellent conditions; expect subtle light in a small scope.",
    equipment: "Telescope · dark skies",
    binocular: false,
  },
  NGC869: {
    story:
      "Two young star clusters sparkle side by side in Perseus, more than 7,000 light years away. They are one of the finest wide field sights in the sky.",
    lookFor:
      "Two dense knots of stars between Perseus and Cassiopeia. Binoculars frame both beautifully; scan for orange stars among the blue white ones.",
    equipment: "Best in binoculars · low power telescope",
    binocular: true,
  },
  "AST-Coathanger": {
    story:
      "This charming pattern really does look like a coat hanger. Its stars are mostly unrelated, lined up by chance from our viewpoint.",
    lookFor:
      "A straight bar of six stars with a curved hook. A wide binocular field makes the shape easiest to recognize.",
    equipment: "Best in binoculars",
    binocular: true,
  },
  "DS-Albireo": {
    story:
      "Albireo, the swan's head at the foot of the Northern Cross, pairs a golden star with a blue one. Precise motions now suggest two stars born together and slowly drifting apart, rather than a couple in orbit.",
    lookFor:
      "A golden star beside a fainter blue-white one, about 34 arcseconds apart. Brace 10×50 binoculars on something solid and the pair splits; at 7× it is harder, so let the image drift and watch for the blue point trailing behind. A small telescope at low power shows the colors best.",
    equipment: "Braced 10×50 binoculars · small telescope",
    binocular: true,
  },
};

export function guideFor(target: UnifiedTarget): ObjectGuide {
  return (
    OBJECT_GUIDES[target.id] ?? {
      story:
        target.desc ||
        `${target.name} is a ${target.category.toLowerCase()} in ${target.con}.`,
      lookFor:
        target.binoTip ||
        "Start with low magnification. Let your eyes adapt to the dark, then use averted vision to pick out faint detail. Extended objects look subtler than photographs.",
      equipment:
        target.source === "binocular"
          ? "Binocular catalog · check observing tip"
          : "Small telescope · dark skies help",
      binocular: target.source === "binocular" || EASY_TARGETS.has(target.id),
    }
  );
}

export function compassLabel(az: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
    Math.round((((az % 360) + 360) % 360) / 45) % 8
  ];
}
export function altitudeLabel(alt: number): string {
  return alt < 0
    ? "Below horizon"
    : alt < 20
      ? "Low in the sky"
      : alt < 40
        ? "Good view"
        : "Well placed";
}
/** Explain the exact altitude bands used by every position badge. */
export function altitudeExplanation(alt:number):string {
  const position=`At ${alt.toFixed(1)}° altitude`;
  if(alt<0)return `${position}, the object is below the horizon (0°) and cannot be seen from this site at the chosen time.`;
  if(alt<20)return `${position}, the object is in the 0°–20° low-altitude band. More atmosphere, haze and nearby obstructions can reduce the view; wait for it to climb if possible.`;
  if(alt<40)return `${position}, the object is in the 20°–40° band. It is clear of the lowest part of the sky, though a higher view usually gives better contrast.`;
  return `${position}, the object is at least 40° above the horizon. It is high enough to avoid much of the low-altitude haze; 90° is directly overhead.`;
}
export function skyConditions(lat: number, lon: number, date: Date) {
  const observer = new Astro.Observer(lat, lon, 0);
  const sun = Astro.Equator(Astro.Body.Sun, date, observer, true, true);
  const moon = Astro.Equator(Astro.Body.Moon, date, observer, true, true);
  const sunAlt = Astro.Horizon(
    date,
    observer,
    sun.ra,
    sun.dec,
  ).altitude;
  const moonHor = Astro.Horizon(date, observer, moon.ra, moon.dec, "normal");
  const phase = Astro.MoonPhase(date);
  return {
    sunAlt,
    moonAlt: moonHor.altitude,
    moonAz: moonHor.azimuth,
    /** Percent, the shared rounding (moon.ts moonIllumination) every tab shows for this instant. */
    illumination: moonIllumination(date).percent,
    moonPhase:
      phase < 22.5 || phase >= 337.5
        ? "New Moon"
        : phase < 67.5
          ? "Waxing crescent"
          : phase < 112.5
            ? "First quarter"
            : phase < 157.5
              ? "Waxing gibbous"
              : phase < 202.5
                ? "Full Moon"
                : phase < 247.5
                  ? "Waning gibbous"
                  : phase < 292.5
                    ? "Last quarter"
                    : "Waning crescent",
    darkness:
      sunAlt < TWILIGHT.astronomical
        ? "Astronomical night"
        : sunAlt < TWILIGHT.nautical
          ? "Astronomical twilight"
          : sunAlt < TWILIGHT.civil
            ? "Nautical twilight"
            : sunAlt < 0
              ? "Civil twilight"
              : "Daylight",
    isDark: sunAlt < TWILIGHT.astronomical,
  };
}
export interface VisibleTarget {
  target: UnifiedTarget;
  alt: number;
  az: number;
  score: number;
}
const EASY_TARGETS = new Set([
  "M2",
  "M3",
  "M4",
  "M5",
  "M11",
  "M15",
  "M22",
  "M27",
  "M34",
  "M35",
  "M39",
  "M41",
  "M44",
  "M47",
  "M67",
  "M81",
  "M82",
  "M92",
  "DS-MizarAlcor",
  "AST-KemblesCascade",
]);
export function rankTargets(
  targets: UnifiedTarget[],
  lat: number,
  lon: number,
  date: Date,
  mode: ObservingMode,
): VisibleTarget[] {
  return targets
    .map((target) => {
      const { alt, az } = eqToHorizontal(target.ra, target.dec, lat, lon, date);
      const friendly =
        guideFor(target).binocular || EASY_TARGETS.has(target.id);
      const score =
        Math.min(60, Math.max(0, alt)) * 0.65 +
        Math.max(0, 9 - target.mag) * 2 +
        (OBJECT_GUIDES[target.id] ? 45 : EASY_TARGETS.has(target.id) ? 30 : 0) +
        (mode === "binocular" && friendly ? 15 : 0) -
        (alt < MIN_ALT.possible ? 60 : 0);
      return { target, alt, az, score };
    })
    .sort((a, b) => b.score - a.score);
}

export interface TonightTarget extends VisibleTarget {
  /** binocularAssessment rating at this altitude, Moon and sky (binocular mode only; null otherwise or below the horizon). */
  rating: FitRating | null;
  /** The shared Moon verdict (lib/sky-feasibility.ts moonVerdict), the same one the journey engine applies. */
  moon: MoonVerdict;
  /** Twilight rule of `rule` passed (bright stars from civil dusk under "possible"). */
  darkEnough: boolean;
  /** Altitude, twilight and Moon all pass under `rule`. */
  feasible: boolean;
}
export interface RankTonightOptions {
  /** Site zenith sky brightness (mag/arcsec²). */
  skyBrightness: number;
  /** Binocular profile; the binocular rating is applied in binocular mode only. */
  profile?: BinocularProfile;
  /** Moon at `date` (computed when absent; pass the planner's currentMoon to avoid recomputing). */
  moon?: MoonState;
  /** Default "possible" (Tonight lists everything that can be seen; "comfortable" = journey standard). */
  rule?: VisibilityRule;
}
/** Tonight's Best penalties on top of rankTargets' score (score points; rankTargets' altitude term is 0.65/°). */
export const TONIGHT_PENALTY = {
  /** Per binocular rating 0..3 (excellent … telescope more rewarding). */
  rating: [0, 5, 20, 45] as const,
  /** Moon verdict fails (too close or brighter than the journey glow limit). */
  moonFails: 25,
  /** Too bright in twilight for this object under the rule. */
  twilight: 30,
} as const;

/**
 * Tonight's Best on the shared sky model: rankTargets' score (altitude, brightness, curated guides, binocular-
 * friendly) minus the Moon (glow × the Planner's per-category weight, and TONIGHT_PENALTY.moonFails when
 * moonVerdict fails), the twilight rule and, in binocular mode, the binocularAssessment rating. The journey engine
 * applies the same moonVerdict and rating model, so Tonight's top objects and tonight's journeys agree.
 */
export function rankTonight(
  targets: UnifiedTarget[],
  lat: number,
  lon: number,
  date: Date,
  mode: ObservingMode,
  opts: RankTonightOptions,
): TonightTarget[] {
  const rule = opts.rule ?? "possible";
  const moon = opts.moon ?? moonState(lat, lon, date);
  const minAlt = minAltitude(rule);
  return rankTargets(targets, lat, lon, date, mode)
    .map((v): TonightTarget => {
      const { target, alt } = v;
      const verdict = moonVerdict({ alt, ra: target.ra, dec: target.dec, category: moonCategoryOfCategory(target.category) }, moon, opts.skyBrightness);
      const dark = darkEnough(moon.sunAlt, { stellar: isStellarCategory(target.category), mag: target.mag }, rule);
      const rating = mode === "binocular" && opts.profile && alt > 0
        ? binocularAssessment(target, opts.profile, { alt, moon, skyBrightness: opts.skyBrightness }).rating
        : null;
      const score = v.score
        - verdict.glow * plannerMoonWeight(target.category, target.mag)
        - (verdict.ok ? 0 : TONIGHT_PENALTY.moonFails)
        - (dark ? 0 : TONIGHT_PENALTY.twilight)
        - (rating === null ? 0 : TONIGHT_PENALTY.rating[rating]);
      return { ...v, score, rating, moon: verdict, darkEnough: dark, feasible: alt >= minAlt && dark && verdict.ok };
    })
    .sort((a, b) => b.score - a.score || a.target.id.localeCompare(b.target.id));
}
export function altitudeSamples(
  target: Pick<UnifiedTarget, "ra" | "dec">,
  lat: number,
  lon: number,
  start: Date,
) {
  return Array.from({ length: 33 }, (_, i) => {
    const date = new Date(start.getTime() + i * 15 * 60_000);
    return {
      date,
      alt: eqToHorizontal(target.ra, target.dec, lat, lon, date).alt,
      dark: skyConditions(lat, lon, date).isDark,
    };
  });
}

/** Orient projected coordinates without reversing text labels. */
export function orientChartPoint(
  point: { x: number; y: number },
  mirrored: boolean,
  rotation: number,
) {
  const angle = (rotation * Math.PI) / 180;
  const x = mirrored ? -point.x : point.x;
  return {
    x: x * Math.cos(angle) - point.y * Math.sin(angle),
    y: x * Math.sin(angle) + point.y * Math.cos(angle),
  };
}
