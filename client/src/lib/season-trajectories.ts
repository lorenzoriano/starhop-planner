/** Seasonal altitude data retains geometry independently of observing thresholds. */
export type SeasonTrajectory = {
  day: string;
  hour: number[];
  alt: number[][];
  dark: boolean[];
  qualified: boolean[][];
};
export type TrajectoryScope = "all" | "dark" | "qualified";
export const ALTITUDE_BANDS = 36; // five degrees, −90..90
export const TIME_BANDS = 48; // local half hours
export const MONTH_COLORS = [
  "#738bff",
  "#ad7ef8",
  "#de70d0",
  "#f2738d",
  "#fb985a",
  "#e6bf47",
  "#b5d453",
  "#6bd589",
  "#43cabc",
  "#4ab6e0",
  "#6b9def",
  "#888ee9",
];
export const altitudeBand = (alt: number) =>
  Math.max(0, Math.min(ALTITUDE_BANDS - 1, Math.floor((alt + 90) / 5)));
export const trajectoryIncluded = (
  track: SeasonTrajectory,
  index: number,
  object: number,
  scope: TrajectoryScope,
) =>
  scope === "all" ||
  (scope === "dark" && track.dark[index]) ||
  (scope === "qualified" && track.qualified[object][index]);
export function trajectoryDensity(
  tracks: SeasonTrajectory[],
  object: number,
  scope: TrajectoryScope,
) {
  const cells = Array.from({ length: TIME_BANDS }, () =>
      Array(ALTITUDE_BANDS).fill(0),
    ),
    totals = Array(TIME_BANDS).fill(0);
  for (const track of tracks) {
    const repeats = Array(TIME_BANDS).fill(0);
    track.hour.forEach((hour) => repeats[Math.floor(hour * 2) % TIME_BANDS]++);
    repeats.forEach((count, time) => {
      if (count) totals[time]++;
    });
    track.hour.forEach((hour, index) => {
      const time = Math.floor(hour * 2) % TIME_BANDS,
        alt = track.alt[object]?.[index];
      if (
        Number.isFinite(alt) &&
        trajectoryIncluded(track, index, object, scope)
      )
        cells[time][altitudeBand(alt)] += 1 / repeats[time];
    });
  }
  return cells.map((row, time) =>
    row.map((count) => (totals[time] ? count / totals[time] : 0)),
  );
}
export function trajectoryCellDates(
  tracks: SeasonTrajectory[],
  object: number,
  scope: TrajectoryScope,
  time: number,
  band: number,
) {
  return tracks
    .filter((track) =>
      track.hour.some(
        (hour, index) =>
          Math.floor(hour * 2) % TIME_BANDS === time &&
          altitudeBand(track.alt[object][index]) === band &&
          trajectoryIncluded(track, index, object, scope),
      ),
    )
    .map((track) => track.day);
}
export function monthlyTrajectories(tracks: SeasonTrajectory[]) {
  const groups = new Map<string, SeasonTrajectory[]>();
  tracks.forEach((track) => {
    const month = track.day.slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), track]);
  });
  return Array.from(groups.values()).map((group) =>
    group.reduce((best, track) =>
      Math.abs(Number(track.day.slice(8)) - 15) <
      Math.abs(Number(best.day.slice(8)) - 15)
        ? track
        : best,
    ),
  );
}
/** Perceptual scale, with explicit percentage legend; zero remains invisible. */
export const densityOpacity = (fraction: number) =>
  fraction > 0 ? Math.pow(Math.min(1, fraction), 0.3) : 0;
export function trajectorySector(
  hour: number,
  until: number,
  alt: number,
  top: number,
) {
  const point = (h: number, a: number) => {
    const angle = (h / 12) * Math.PI - Math.PI / 2,
      r = ((a + 90) / 180) * 254;
    return { x: 320 + Math.cos(angle) * r, y: 320 + Math.sin(angle) * r, r };
  };
  const a = point(hour, top),
    b = point(until, top),
    c = point(until, alt),
    d = point(hour, alt);
  return `M${a.x},${a.y} A${a.r},${a.r} 0 0 1 ${b.x},${b.y} L${c.x},${c.y} ${c.r > 0 ? `A${c.r},${c.r} 0 0 0 ${d.x},${d.y}` : ""} Z`;
}
