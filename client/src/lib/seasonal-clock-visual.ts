import { clockPoint } from "./astronomical-clock";
import {
  trajectoryIncluded,
  type SeasonTrajectory,
  type TrajectoryScope,
} from "./season-trajectories";

/** Twelve separated hues for monthly paths, repeated consistently in labels. */
export const MONTH_COLORS = [
  "#e6194b",
  "#3cb44b",
  "#ffe119",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#46f0f0",
  "#f032e6",
  "#bcf60c",
  "#fabebe",
  "#008080",
  "#e6beff",
] as const;

export type MonthlyTrajectoryPoint = {
  day: string;
  sample: number;
  x: number;
  y: number;
  altitude: number;
  hour: number;
  distance: number;
};

/** Find the closest real sampled point on the visible monthly trajectories. */
export function nearestMonthlyTrajectoryPoint(
  tracks: SeasonTrajectory[],
  object: number,
  scope: TrajectoryScope,
  x: number,
  y: number,
  focusedDay?: string | null,
): MonthlyTrajectoryPoint | null {
  let nearest: MonthlyTrajectoryPoint | null = null;
  for (const track of tracks) {
    if (focusedDay && track.day !== focusedDay) continue;
    for (let sample = 0; sample < track.hour.length; sample++) {
      if (!trajectoryIncluded(track, sample, object, scope)) continue;
      const altitude = track.alt[object]?.[sample];
      if (!Number.isFinite(altitude)) continue;
      const point = clockPoint(track.hour[sample], altitude),
        distance = Math.hypot(point.x - x, point.y - y);
      if (!nearest || distance < nearest.distance)
        nearest = {
          day: track.day,
          sample,
          x: point.x,
          y: point.y,
          altitude,
          hour: track.hour[sample],
          distance,
        };
    }
  }
  return nearest;
}
