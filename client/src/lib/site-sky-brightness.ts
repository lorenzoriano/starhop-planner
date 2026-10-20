/** Per-location user assumptions for moonless zenith sky brightness (mag/arcsec²). */
const STORAGE_KEY = "starhop-site-sky-brightness-v1";

export const SKY_BRIGHTNESS_REFERENCES = [
  { value: 17.5, label: "Bright urban reference" },
  { value: 19.0, label: "Urban conservative reference" },
  { value: 20.5, label: "Rural reference" },
  { value: 21.6, label: "Dark-sky reference" },
] as const;

/** Conservative unconfirmed reference until the observer chooses a site assumption. */
export function suggestedSiteSkyBrightness(lat: number, lon: number) {
  return 19.0;
}

export function siteSkyBrightnessKey(lat: number, lon: number) {
  // Keep sites distinct to roughly ten metres while collapsing floating point noise.
  const normalized = (value: number) => {
    const rounded = Number(value.toFixed(4));
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  return `${normalized(lat)},${normalized(lon)}`;
}

function readStore(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 17 && entry[1] <= 22,
    ));
  } catch {
    return {};
  }
}

export function getSiteSkyBrightness(lat: number, lon: number): number | undefined {
  return readStore()[siteSkyBrightnessKey(lat, lon)];
}

export function saveSiteSkyBrightness(lat: number, lon: number, value: number): boolean {
  if (!Number.isFinite(value) || value < 17 || value > 22) return false;
  try {
    const store = readStore();
    store[siteSkyBrightnessKey(lat, lon)] = Math.round(value * 10) / 10;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

