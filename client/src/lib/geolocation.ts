/** The device's position for "Use my current location", with errors explained in words the user can act on. */
export interface DevicePosition { lat: number; lon: number }

export type LocateResult = { ok: true; position: DevicePosition } | { ok: false; message: string };

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** What to tell the user for a GeolocationPositionError code (1 denied, 2 unavailable, 3 timeout). */
export function locationErrorMessage(code: number | undefined, platform = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const mac = /Macintosh|Mac OS X/.test(platform) && !/Mobile/.test(platform);
  const android = /Android/.test(platform);
  if (code === 1) return "Location permission is blocked for this site. Allow it from the icon at the left of the address bar, then try again.";
  if (code === 2) {
    if (mac) return "The browser has permission, but macOS is not sharing a position with it. Open System Settings → Privacy & Security → Location Services, turn it on, and enable your browser (e.g. Google Chrome). Then try again.";
    if (android) return "Your phone could not find a position. Turn on Location in the quick settings, then try again.";
    return "Your device could not find a position. Check that the system's location services are on, then try again.";
  }
  if (code === 3) return "Finding your position took too long. Try again, ideally with Wi-Fi on.";
  return "This browser cannot share your location. Enter latitude and longitude instead.";
}

function once(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
}

/** Asks for permission if needed. A coarse fix is enough for the sky; one retry with high accuracy covers devices whose
 *  network positioning fails or times out (common on desktops without Wi-Fi positioning). */
export async function locateDevice(): Promise<LocateResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return { ok: false, message: locationErrorMessage(undefined) };
  let lastCode: number | undefined;
  for (const options of [
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  ] satisfies PositionOptions[]) {
    try {
      const p = await once(options);
      return { ok: true, position: { lat: round4(p.coords.latitude), lon: round4(p.coords.longitude) } };
    } catch (error) {
      lastCode = (error as GeolocationPositionError | undefined)?.code;
      if (lastCode === 1) break; // denied: retrying would fail the same way
    }
  }
  return { ok: false, message: locationErrorMessage(lastCode) };
}
