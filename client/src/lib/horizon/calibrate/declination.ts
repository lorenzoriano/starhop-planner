/**
 * Magnetic declination from the World Magnetic Model (WMM-2025), for turning compass headings into true ones.
 *
 * Only the WMM-2025 coefficient file (~3.6 KB) is imported from the `geomagnetism` package: its index bundles every
 * historic model and builds a model object per call, which the app does not need. The evaluator below is the standard
 * WMM spherical-harmonic sum (degree 12, Schmidt semi-normalised Legendre functions), the same maths as the package,
 * at sea level on the WGS-84 ellipsoid. Outside the model's 2025–2030 validity it simply extrapolates the secular
 * variation (errors grow by a fraction of a degree per year), which is fine for a compass seed.
 */
import wmm2025 from 'geomagnetism/data/wmm-2025.json';

const RAD = Math.PI / 180;

interface WmmCoefficients {
  epoch: number;
  n_max: number;
  main_field_coeff_g: number[];
  main_field_coeff_h: number[];
  secular_var_coeff_g: number[];
  secular_var_coeff_h: number[];
}

const MODEL = wmm2025 as WmmCoefficients;
const N = MODEL.n_max;
// WGS-84 ellipsoid and the geomagnetic reference radius, km.
const A = 6378.137, B = 6356.7523142, RE = 6371.2;
const EPS_SQ = 1 - (B * B) / (A * A);

/** Decimal year as the package computes it (365-day years), so results match it exactly. */
function decimalYear(date: Date): number {
  const y = date.getUTCFullYear();
  return y + (date.getTime() - Date.UTC(y, 0, 1)) / (1000 * 3600 * 24 * 365);
}

/** Schmidt semi-normalised associated Legendre functions P(n,m)(sin φ) and their derivatives d/dφ, index n(n+1)/2 + m. */
function legendre(x: number): { p: Float64Array; dp: Float64Array } {
  const size = ((N + 1) * (N + 2)) / 2;
  const p = new Float64Array(size), dp = new Float64Array(size);
  const z = Math.sqrt((1 - x) * (1 + x));
  p[0] = 1;
  for (let n = 1; n <= N; n++) {
    for (let m = 0; m <= n; m++) {
      const i = (n * (n + 1)) / 2 + m;
      if (n === m) {
        const i1 = ((n - 1) * n) / 2 + m - 1;
        p[i] = z * p[i1];
        dp[i] = z * dp[i1] + x * p[i1];
      } else if (n === 1 && m === 0) {
        p[i] = x * p[0];
        dp[i] = x * dp[0] - z * p[0];
      } else {
        const i1 = ((n - 2) * (n - 1)) / 2 + m, i2 = ((n - 1) * n) / 2 + m;
        if (m > n - 2) {
          p[i] = x * p[i2];
          dp[i] = x * dp[i2] - z * p[i2];
        } else {
          const k = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
          p[i] = x * p[i2] - k * p[i1];
          dp[i] = x * dp[i2] - z * p[i2] - k * dp[i1];
        }
      }
    }
  }
  // Gauss → Schmidt semi-normalisation (the derivative's sign follows the WMM convention: d/dφ, φ = latitude).
  const norm = new Float64Array(size);
  norm[0] = 1;
  for (let n = 1; n <= N; n++) {
    const i0 = (n * (n + 1)) / 2;
    norm[i0] = (norm[((n - 1) * n) / 2] * (2 * n - 1)) / n;
    for (let m = 1; m <= n; m++) {
      norm[i0 + m] = norm[i0 + m - 1] * Math.sqrt(((n - m + 1) * (m === 1 ? 2 : 1)) / (n + m));
    }
  }
  for (let i = 1; i < size; i++) {
    p[i] *= norm[i];
    dp[i] *= -norm[i];
  }
  return { p, dp };
}

/**
 * Magnetic declination at sea level, degrees, east positive: true bearing = magnetic bearing + declination.
 * Near the geographic poles (|lat| > 89.99°) the east component is undefined; 0 is returned there.
 */
export function magneticDeclinationDeg(lat: number, lon: number, date: Date): number {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 89.99) return 0;
  const dt = decimalYear(date) - MODEL.epoch;
  // Geodetic → geocentric (spherical) coordinates.
  const sinLat = Math.sin(lat * RAD), cosLat = Math.cos(lat * RAD);
  const rc = A / Math.sqrt(1 - EPS_SQ * sinLat * sinLat);
  const xp = rc * cosLat, zp = rc * (1 - EPS_SQ) * sinLat;
  const r = Math.hypot(xp, zp);
  const phig = Math.asin(zp / r);
  const { p, dp } = legendre(Math.sin(phig));

  let bx = 0, by = 0, bz = 0;
  let radiusPower = (RE / r) * (RE / r);
  for (let n = 1; n <= N; n++) {
    radiusPower *= RE / r;
    for (let m = 0; m <= n; m++) {
      const i = (n * (n + 1)) / 2 + m;
      const g = MODEL.main_field_coeff_g[i] + dt * MODEL.secular_var_coeff_g[i];
      const h = MODEL.main_field_coeff_h[i] + dt * MODEL.secular_var_coeff_h[i];
      const cm = Math.cos(m * lon * RAD), sm = Math.sin(m * lon * RAD);
      bz -= radiusPower * (g * cm + h * sm) * (n + 1) * p[i];
      by += radiusPower * (g * sm - h * cm) * m * p[i];
      bx -= radiusPower * (g * cm + h * sm) * dp[i];
    }
  }
  by /= Math.cos(phig);
  // Rotate from geocentric to geodetic north (only the north component matters for the declination).
  const psi = phig - lat * RAD;
  const north = bx * Math.cos(psi) - bz * Math.sin(psi);
  return Math.atan2(by, north) / RAD;
}
