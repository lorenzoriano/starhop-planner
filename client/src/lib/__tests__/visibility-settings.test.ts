import { describe, expect, it } from "vitest";
import { defaultSettings, settingsSchema, type Settings } from "../session";
import { applySettingsPatch } from "../settings-patch";
import { airQualityHourAt, airQualityUrl, parseAirQuality, readAirQuality, saveAirQuality } from "../air-quality";
import { parseWeather, weatherForecastSchema } from "../weather";
import { createBackup, parseBackupText } from "../backup";

const stored = (extra: Record<string, unknown>) => ({ ...defaultSettings, binocularSupport: undefined, transparencyMode: undefined, observerAge: undefined, siteElevation: undefined, ...extra });

describe("visibility settings", () => {
  it("migrates binocularStabilized to binocularSupport and defaults the new fields", () => {
    const on = settingsSchema.parse(stored({ binocularStabilized: true }));
    expect(on).toMatchObject({ binocularSupport: "stabilized", binocularStabilized: true, transparencyMode: "auto", observerAge: "30-49", siteElevation: null });
    const off = settingsSchema.parse(stored({ binocularStabilized: false }));
    expect(off).toMatchObject({ binocularSupport: "handheld", binocularStabilized: false });
    expect(settingsSchema.parse(stored({ binocularStabilized: false, binocularSupport: "tripod" })).binocularStabilized).toBe(true);
    expect(settingsSchema.parse(defaultSettings)).toMatchObject({ binocularSupport: "stabilized", binocularStabilized: true });
  });
  it("validates the new fields", () => {
    expect(settingsSchema.parse(stored({ transparencyMode: 4, observerAge: "50-plus", siteElevation: 1240 }))).toMatchObject({ transparencyMode: 4, observerAge: "50-plus", siteElevation: 1240 });
    expect(settingsSchema.safeParse(stored({ transparencyMode: 6 })).success).toBe(false);
    expect(settingsSchema.safeParse(stored({ siteElevation: 20000 })).success).toBe(false);
  });
  it("keeps support and stabilized in step in planner patches", () => {
    const prev: Settings = { ...defaultSettings };
    expect(applySettingsPatch(prev, { binocularSupport: "handheld" })).toMatchObject({ binocularSupport: "handheld", binocularStabilized: false });
    expect(applySettingsPatch(prev, { binocularSupport: "tripod" })).toMatchObject({ binocularSupport: "tripod", binocularStabilized: true });
    expect(applySettingsPatch(prev, { binocularStabilized: false })).toMatchObject({ binocularSupport: "handheld", binocularStabilized: false });
    const tripod = applySettingsPatch(prev, { binocularSupport: "tripod" });
    expect(applySettingsPatch(tripod, { binocularStabilized: true }).binocularSupport).toBe("tripod");
  });
  it("drops a manual elevation when the site moves, unless the patch sets one", () => {
    const prev: Settings = { ...defaultSettings, siteElevation: 1500 };
    expect(applySettingsPatch(prev, { limitingMag: 7 }).siteElevation).toBe(1500);
    expect(applySettingsPatch(prev, { lat: prev.lat + 0.001 }).siteElevation).toBe(1500);
    expect(applySettingsPatch(prev, { lat: 51.5, lon: -0.12 }).siteElevation).toBeNull();
    expect(applySettingsPatch(prev, { lat: 51.5, lon: -0.12, siteElevation: 40 }).siteElevation).toBe(40);
  });
});

describe("backups of the new settings", () => {
  it("round-trips them through a compact (link) backup, leaving out the default values", () => {
    const data = (settings: Settings) => ({ settings, planner: { sessions: [], activeId: null }, savedLocations: [] });
    const plain = createBackup(data(defaultSettings) as never, new Date(), { compact: true });
    expect(plain).not.toContain("transparencyMode");
    expect(parseBackupText(plain).backup.settings).toMatchObject({ transparencyMode: "auto", observerAge: "30-49", siteElevation: null, binocularSupport: "stabilized" });
    const custom: Settings = { ...defaultSettings, transparencyMode: 2, observerAge: "50-plus", siteElevation: 800, binocularSupport: "tripod" };
    expect(parseBackupText(createBackup(data(custom) as never, new Date(), { compact: true })).backup.settings).toMatchObject({ transparencyMode: 2, observerAge: "50-plus", siteElevation: 800, binocularSupport: "tripod", binocularStabilized: true });
  });
});

describe("forecast elevation and air quality", () => {
  it("keeps the forecast elevation and still reads old cached forecasts without it", () => {
    const raw = { elevation: 1240, hourly_units: { time: "unixtime", cloud_cover: "%", cloud_cover_low: "%", cloud_cover_mid: "%", cloud_cover_high: "%", temperature_2m: "°C", dew_point_2m: "°C", relative_humidity_2m: "%", precipitation_probability: "%", precipitation: "mm", wind_speed_10m: "km/h", wind_gusts_10m: "km/h", visibility: "m" },
      hourly: Object.fromEntries([["time", [1793923200, 1793926800]], ...["cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "temperature_2m", "dew_point_2m", "relative_humidity_2m", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "visibility"].map((k) => [k, [10, 10]])]) };
    const f = parseWeather(raw, 39.7, -105.2, 1793923200000);
    expect(f.elevation).toBe(1240);
    expect(parseWeather({ ...raw, elevation: "nope" }, 39.7, -105.2).elevation).toBeNull();
    const { elevation: _e, ...old } = f;
    expect(weatherForecastSchema.safeParse(old).success).toBe(true);
  });
  it("parses the Open-Meteo air-quality response and finds the hour", () => {
    expect(airQualityUrl(37.77, -122.42)).toContain("hourly=aerosol_optical_depth%2Cdust");
    const t0 = 1793923200;
    const raw = { elevation: 14, hourly_units: { time: "unixtime", aerosol_optical_depth: "" }, hourly: { time: [t0, t0 + 3600, t0 + 7200], aerosol_optical_depth: [0.08, null, 0.3], dust: [0, 0, 1] } };
    const f = parseAirQuality(raw, 37.77, -122.42, t0 * 1000);
    expect(f.elevation).toBe(14);
    expect(airQualityHourAt(f, t0 * 1000 + 1800_000)?.aod).toBe(0.08);
    expect(airQualityHourAt(f, (t0 + 3600) * 1000)?.aod).toBeNull();
    expect(airQualityHourAt(f, (t0 + 3 * 3600) * 1000)).toBeUndefined();
    expect(() => parseAirQuality({ ...raw, hourly: { ...raw.hourly, aerosol_optical_depth: [0.1] } }, 37.77, -122.42)).toThrow();
    const disk = new Map<string, string>(), storage = { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => void disk.set(k, v) };
    expect(saveAirQuality(f, storage)).toBe(true);
    expect(readAirQuality(37.77, -122.42, storage)?.hours).toEqual(f.hours);
  });
});
