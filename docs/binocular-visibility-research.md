# Binocular visibility model: research and implementation spec

Status: research spec, not yet implemented. Researched 2026-11-06.
Goal: for a deep-sky object, a binocular and tonight's conditions, give a 5-level rating and the main reason(s) for it.
A Python reference implementation of the chain in this document was run to produce the sanity numbers in section 9. That script is not part of the repo.

---

## 0. Overview of the chain

```
inputs ──► (1) observer: eye pupil p(age), field factor F
       ──► (2) binocular: D, M, exit pupil d=D/M, transmission t, steadiness factor F_S
       ──► (3) atmosphere: extinction k (elevation, haze/AOD), airmass X(alt)
       ──► (4) sky at the object: zenith SQM → airmass brightening + Moon (Krisciunas & Schaefer)
       ──► (5) eyepiece background B_a and apparent target area A_a
       ──► (a) extended-object margin  = log10(C_obj / C_threshold)     (Crumey 2014)
       ──► (b) stellar limiting magnitude in the binocular             (Crumey 2014 eqs 65-68)
       ──► (c) double-star splittability                                (eye resolution / M, Δm, shake)
       ──► (d) cluster resolvability                                    (brightest stars vs LM, crowding)
       ──► rating (5 levels) + reasons (counterfactual attribution)
```

All magnitudes are V (visual). Surface brightness µ is in mag/arcsec². Luminance B is in cd/m². Illuminance I is in lux.

---

## 1. Unit conversions (Crumey 2014; Krisciunas & Schaefer 1991)

| Quantity | Formula | Source |
|---|---|---|
| surface brightness ↔ luminance | `B[cd/m²] = 10^(-0.4·(µ − 12.58))`, `µ = 12.58 − 2.5·log10(B)` | Crumey 2014 §1.3 (Z_V = 2.54e-6 lx) |
| magnitude ↔ illuminance | `I[lx] = 10^(-0.4·(m + 13.99))`, `m = −2.5·log10(I) − 13.99` | Crumey 2014 §1.3 |
| nanoLambert ↔ µ | `B_nL = 34.08·exp(20.7233 − 0.92104·µ)`, `µ = (20.7233 − ln(B_nL/34.08)) / 0.92104` | K&S 1991 eq 1 (Garstang 1989) |
| nL ↔ cd/m² | `1 nL = 3.183e-6 cd/m²` (1 L = 10⁴/π cd/m²) | definition |
| object mean surface brightness (ellipse) | `µ_obj = m + 2.5·log10(π/4 · a · b · 3600)`, with a, b in arcmin | standard (π/4·3600 = 2827) |
| solid angle | `A[sr] = (π/4 · a · b) / 3437.75²`, with a, b in arcmin | |

Check: µ = 21.83 gives B = 2.0e-4 cd/m², which matches Crumey's dark-sky reference value.

---

## 2. Observer

### 2.1 Dark-adapted pupil vs age
- Simple rule: `p = clamp(7.0 − 0.05·(age − 20), 4.5, 7.5)` mm. That gives 7 mm at 20, 6 at 40, 5 at 60. If age is unknown, use p = 6.0 mm.
  - Supporting data: Bowen's measured 5.2 mm at age 49 (Crumey 2014 §3.2). Herschel measured 5.08 mm. Population studies show a wide spread of ±1 mm at any age (Winn et al. 1994, IOVS 35:1132). A more elaborate option is the Watson & Yellott 2012 unified pupil formula (J. Vision 12(10):12).
- p only matters when the exit pupil d > p. Then the eye clips the beam, which acts as if the aperture were `D_eff = M·p`.

### 2.2 Field factor F (observer and conditions skill multiplier on threshold)
- Crumey's notional typical value is **F = 2**. Practical observers fall in the range **1.4 to 2.4**, and F ≈ 1 corresponds to an exceptional observer.
- With F = 2, the naked-eye limit at µ = 21.83 is 6.18 mag. The general form is `m0 = 6.93 − 2.5·log10(F)`.
- F can be calibrated from a user-reported NELM when the SQM is known. Solve eq (B1) in §6.2 for F: `F = 10^(0.4·(m0(F=1) − NELM))`.
- Age: older observers can be modelled by raising F, for example ×1.2 above 60. This is a heuristic; ocular-media losses are not separately modelled here.

---

## 3. Binocular

| Symbol | Meaning | Default |
|---|---|---|
| D | objective diameter (mm) | input |
| M | magnification | input |
| d = D/M | exit pupil (mm) | |
| δmin = min(d, p), δmax = max(d, p) | | |
| t | transmission (Ft = 1/t) | 0.85 for good multi-coated binoculars, 0.75 for cheap ones; Crumey used 0.75 for telescopes |
| F_T | monocular/binocular factor | **1.0 for binoculars**. Crumey uses √2 for one-eyed telescope viewing, from Lythgoe & Phillips 1938; binocular summation is therefore already in the naked-eye F. |
| F_S | steadiness factor (Crumey's F_M slot) | see 3.1 |

`φ = F · F_T · F_S`. This is the total multiplier applied to the laboratory contrast threshold.

Note on binocular summation: Crumey/Schaefer treat two eyes as a √2 better threshold (0.38 mag). Ed Zarenski's field tests (sci.astro.amateur 2003) found only a 15–20% gain for stars (about 0.15–0.2 mag). Tony Flanders noted in the same thread that the gain may be larger for diffuse objects. Use F_T = 1 for binoculars and √2 only if the app ever supports monocular devices.

### 3.1 Hand-held vs image-stabilized vs tripod (F_S)

The quantitative literature here is thin. These are the best numbers found:
- **BirdForum bar-target test, Canon 10x42 IS L:** going from tripod to hand-held lost **43%** of resolved detail. Tripod to IS hand-held lost **8%**. IS vs non-IS hand-held was a **32%** difference.
- **Sky at Night magazine:** a steady hold "can gain up to at least one magnitude" of star faintness. This is unmeasured.
- **Ed Zarenski:** 12x50 binoculars are noticeably harder to hold than 10x. 15x is commonly cited as the hand-holding limit.

Recommended engineering model (heuristic, tunable):

| Mount | Limiting-mag penalty ΔS (mag) | `F_S = 10^(0.4·ΔS)` | Resolution multiplier s_res |
|---|---|---|---|
| tripod / mount | 0 | 1.0 | 1.0 |
| image-stabilized (IS on) | 0.1 | 1.10 | 1.10 |
| hand-held, braced (elbows on chair/car) | 0.15 + 0.03·max(0, M−7) | | 1.25 + 0.03·max(0, M−7) |
| hand-held, free | 0.3 + 0.05·max(0, M−7) | e.g. 10x gives 0.45 mag, F_S = 1.51; 15x gives 0.7 mag | 1.75 at 10x, then +0.08 per extra 1x |

Apply F_S to stars and small objects. For large diffuse objects (apparent size > 2°) use `sqrt(F_S)`, because shake hurts point sources most.

---

## 4. Atmosphere

### 4.1 Airmass
- **Extinction airmass** (Rozenberg 1966; used by Green 1992 ICQ and K&S eq 14): `X = 1 / (cos z + 0.025·exp(−11·cos z))`, with z = 90° − alt. X = 40 at the horizon.
  - Alternative is Kasten & Young 1989: `X = 1 / (cos z + 0.50572·(96.07995 − z°)^−1.6364)`.
- **Scattering airmass for sky glow** (K&S eq 3): `X_s = (1 − 0.96·sin² z)^−0.5`.

### 4.2 Extinction coefficient k (mag/airmass), by elevation h in km (Green 1992, ICQ 14:55)
```
k_Ray = 0.1451 · exp(−h / 7.996)            (λ ≈ 510 nm, scotopic peak)
k_aer = 0.120  · exp(−h / 1.5) · s_aer      (A0 = 0.05; s_aer = haze scale)
k_oz  = 0.016
k     = k_Ray + k_aer + k_oz
```
Typical values: sea level 0.28, 1 km 0.21, 2.2 km 0.15. Schaefer's empirical guide: about 0.20 on an average mountain night or a good dry sea-level night. At humid sites, 0.25, 0.30 and 0.40 correspond to good, average and poor nights.

**Transparency levels 1–5 → s_aer:** 1 excellent: 0.3; 2 good: 0.6; 3 average: 1.0; 4 hazy: 2.0; 5 very hazy/smoky: 3.5.
At sea level these give k = 0.20, 0.23, 0.28, 0.40, 0.58.

**From weather APIs (Open-Meteo):**
1. **Preferred: CAMS aerosol optical depth.** Use `aerosol_optical_depth` from the Open-Meteo Air-Quality API (550 nm). Then `k_aer = 1.086 · τ550 · (550/510)^1.3 ≈ 1.19 · τ550`.
   - τ is a column total for the model grid cell. If the site is much higher than the grid elevation, scale by `exp(−(h_site − h_grid)/1.5 km)`.
   - Typical τ550 values: 0.05 is very clear; 0.1–0.15 is normal continental; 0.3 is hazy; above 0.5 is smoke or dust.
2. **Fallback: horizontal visibility V** (`visibility` in m, weather API).
   - Koschmieder: `β_ext = 3.912 / V_km` (km⁻¹).
   - `β_aer = max(β_ext − 0.0116, 0)`.
   - `τ_aer ≈ β_aer · H_aer`, with H_aer ≈ 1.2–1.5 km.
   - Worked values: V = 50 km gives τ ≈ 0.09; 20 km gives 0.25; 10 km gives 0.49.
   - Caveat: the visibility product is often capped at about 24 km, so it can only detect haze, not certify a clear night.
3. **Relative humidity** (`relative_humidity_2m`) is only a modifier when you have no AOD. Hygroscopic growth is roughly `τ(RH) = τ_dry · ((1 − RH)/(1 − 0.5))^−0.5` for RH > 50%, capped at RH 0.95. Above 90% also warn about dew/fog. CAMS AOD already includes humidity effects, so do not double-apply.

### 4.3 Effect on the object
`m_obs = m + k·X(alt)`. Surface brightness dims by the same `k·X`.
Below about 10° altitude, also flag "too low": X > 5.6, and real-world obstructions are likely.

---

## 5. Sky brightness at the object

### 5.1 Zenith baseline from darkness category (dark-sky, moonless, astronomical night)

| Bortle | SQM mag/arcsec² (Wikipedia range) | Use (midpoint) | NELM (Bortle) | Milky Way / plain-English clue |
|---|---|---|---|---|
| 1 | 21.76–22.0 | 21.9 | 7.6–8.0 | Zodiacal light obvious; Milky Way casts shadows |
| 2 | 21.6–21.75 | 21.7 | 7.1–7.5 | Summer Milky Way highly structured |
| 3 | 21.3–21.6 | 21.45 | 6.6–7.0 | Rural; Milky Way still complex; light domes on horizon |
| 4 | 20.8–21.3 | 21.05 | 6.3–6.5 | Milky Way impressive overhead but lacks detail |
| 4.5 | 20.3–20.8 | 20.55 | 6.1–6.3 | Semi-suburban; Milky Way faint near horizon |
| 5 | 19.25–20.3 | 19.8 | 5.6–6.0 | Suburban; Milky Way washed out overhead |
| 6 | 18.5–19.25 | 18.9 | 5.1–5.5 | Bright suburban; Milky Way only near zenith, if at all |
| 7 | 18.0–18.5 | 18.25 | 4.6–5.0 | Suburban/urban transition; Milky Way invisible |
| 8 | 17.5–18.0 | 17.75 | 4.1–4.5 | City |
| 9 | < 17.5 | 17.0 | ≤ 4.0 | Inner city |

Notes:
- Bortle's NELMs are for expert observers. Crumey 2014 notes that Bortle overestimates faint-object visibility for typical observers.
- The DeepskyLog/pydeepskylog Bortle→SQM map (21.85, 21.6, 21.4, 20.85, 19.75, 18.8, 18.25, 17.75, 17.5) is a fine alternative.
- NELM↔SQM (Schaefer-derived, Unihedron calculator): `NELM = 7.93 − 5·log10(10^(4.316 − SQM/5) + 1)`. The inverse is `SQM = 21.58 − 5·log10(10^(1.586 − NELM/5) − 1)`. Uncertainty is ±0.5–1 mag (JAAVSO 42, 2014).
  - Prefer Crumey's own relation (§6.2) inside this model so everything stays consistent.

### 5.2 Brightening toward the horizon (natural component; K&S eq 2)
```
B0(Z) = B_zen · 10^(−0.4·k·(X_s − 1)) · X_s        (nL or cd/m², linear units)
```
- For light-polluted skies (Bortle ≥ 5), the artificial part rises faster toward the horizon, especially toward the city. Heuristic: split `B_zen = B_nat (≈ 21.9 mag/arcsec²) + B_art`.
- Apply the formula above to B_nat. Multiply B_art by `X_s^1.5` (or by a user-chosen "light dome direction" boost of ×2 to ×3 below 30° altitude).
- **Haze and light pollution:** haze darkens a natural sky slightly but brightens an artificial one. Heuristic: `B_art *= (k / 0.25)` (capped at ×3).

### 5.3 Moonlight (Krisciunas & Schaefer 1991, PASP 103:1033)

Inputs:
- α = lunar phase angle in degrees (0 = full, 90 ≈ 50% illuminated, 180 = new). Use `α = acos(2·illum − 1)` approximately.
- ρ = Moon–object separation in degrees.
- Z_m, Z = zenith distances of the Moon and the object.
- k = extinction coefficient.

```
I*    = 10^(−0.4·(3.84 + 0.026·|α| + 4e−9·α⁴))                        (eq 20; Moon illuminance, scaled units)
f(ρ)  = 10^5.36·(1.06 + cos²ρ) + 10^(6.15 − ρ/40)          for ρ ≥ 10°   (eq 21: Rayleigh + Mie)
f(ρ)  = 10^5.36·(1.06 + cos²ρ) + 6.2e7 / ρ²                 for ρ < 10°   (eq 19, aureole)
X(Z)  = (1 − 0.96·sin²Z)^−0.5                                             (eq 3)
B_moon[nL] = f(ρ) · I* · 10^(−0.4·k·X(Z_m)) · [1 − 10^(−0.4·k·X(Z))]      (eq 15)
ΔV    = −2.5·log10((B_moon + B0(Z)) / B0(Z))                               (eq 22)
```
- B_moon = 0 if the Moon's altitude ≤ 0. Optionally taper over Moon altitude −2°…0°.
- Model accuracy is 8–23%. Opposition surge within about 1 day of full Moon gives up to ×1.35. Very near the Moon, glare inside the binocular field also matters: flag ρ < 5–10° as "glare".
- **Verified:** α = 90°, ρ = 60°, Z_m = 60°, k = 0.172 gives 99 nL, which matches K&S Table 2.

Sky at the object: `B_sky = B0(Z) + B_moon (+ twilight if Sun > −18°)`. Then µ_sky = conversion of B_sky.

---

## 6. Core visual model: Crumey 2014 (MNRAS 442:2600)

### 6.1 Constants (Blackwell 1946 scotopic fit)
```
r1 = 6.505e−4, r2 = −8.461e−4          (point-source / Ricco term,   eq 48)
k1 = 7.633e−3, k2 = −7.174e−3          (large-target asymptote C∞, eq 49)
q  = 0.6                               (for B < 0.193 cd/m², eq 44)
```
Valid for 1e−5 ≤ B ≤ 3.4e−2 cd/m², i.e. µ ≈ 16.2 to 25.1. That range covers any night sky in an eyepiece; anything brighter is mesopic. Below 1e−5 cd/m², clamp B to 1e−5 (Crumey's zero-background cut-off, eqs 50–52).

Naked-eye contrast threshold for a uniform target of solid angle A (sr) on background B (eq 47, with field factor):
```
R(B)  = (r1·B^−1/4 + r2)²        Ricco constant  (C·A = R for small targets)
C∞(B) = k1·B^−1/4 + k2           large-target threshold
C_th  = φ · [ (R/A)^q + C∞^q ]^(1/q)
```

### 6.2 Naked-eye point-source limit (eq 53; used for calibration and the NELM inversion)
```
ΔI = F·(r1·B^1/4 + r2·B^1/2)²   [lux]      m0 = −2.5·log10(ΔI) − 13.99            (B1)
```
Linear approximations:
- `m0 = 0.4260·µ_sky − 2.365 − 2.5·log10 F` for 21 < µ < 25 (eq 55).
- `m0 = 0.3834·µ_sky − 1.440 − 2.5·log10 F` for 20 < µ < 22 (eq 54).

**Caveat:** Crumey's naked-eye limit is optimistic in bright skies. With F = 2 it gives 4.9 at µ = 18.0 and 4.8 at µ = 17.0, whereas Bortle 7–8 observers report about 4.1–5.0 and the Schaefer/Unihedron formula gives 4.0 at 18.0. The fit uses Blackwell's 2850 K source; urban skyglow is spectrally different and approaches mesopic levels. For µ_sky < 19, consider adding a penalty of about 0.25·(19 − µ_sky) mag to LM and the equivalent to C_th. This is a heuristic to tune against user reports.

Large-target surface-brightness limit (eq 57): `µ∞ = 0.6864·µ_sky + 9.9325 − 2.5·log10 F` for 18 < µ < 22.

### 6.3 Through the binocular (Crumey §3.2–3.3, eqs 65–88, after Tousey & Hulburt 1948)
```
B_a = (δmin/p)² · B_sky / Ft                     eyepiece background, eq 66 (clamp ≥ 1e−5)
A_a = M² · A                                     apparent target solid angle, eq 79
R_a = (r1·B_a^−1/4 + r2)²,  C_a = k1·B_a^−1/4 + k2     eqs 78, 80
C_th = φ · [ (R_a/A_a)^q + C_a^q ]^(1/q)          eq 77,   φ = F·F_T·F_S
```
- **Object contrast** is unchanged by the instrument, because object and sky are dimmed by the same pupil and transmission factors:
  `C_obj = B_obj / B_sky = 10^(−0.4·(µ_obj + k·X − µ_sky))`. Here µ_sky already includes airmass, Moon and haze.
- **(a) Visibility margin:** `VM = log10(C_obj / C_th)`. To express it in magnitudes, use `VM_mag = 2.5·VM`.

### 6.4 (b) Stellar limiting magnitude in the binocular (eqs 65–68)
```
ΔI_a = φ · (r1·B_a^1/4 + r2·B_a^1/2)²
ΔI   = (δmax / D)² · Ft · ΔI_a                   (D and δ in the same units)
LM   = −2.5·log10(ΔI) − 13.99 − k·X              (catalogue V magnitude just visible at this altitude)
```
Closed-form approximation (eq 69, valid for µ 21–25):
```
LM = 0.426·µ_sky − 2.365 + 5·log10(D/δmax) − 2.131·log10(δmin/p) − 1.435·log10(Ft) − 2.5·log10(φ) − k·X
```
- For dark-sky, zero-background telescopes, Crumey gives `m_cut = 5·log10(D_cm) + 8.45 − 2.5·log10 F`. With F = 2 this reproduces Sinnott's N = 7.7 in `m = N + 5·log D_cm`.
- Binoculars sit about 1 mag below telescopes of equal aperture because of their low magnification (Zarenski).
- The model reproduces this: a 10x50 at Bortle 3 gives LM 10.35 (tripod) at 60° altitude. Zarenski measured a maximum of about 10.0 for 40 mm, about 11.0 for 60 mm, and about 12.0 for 100 mm at NELM 6.5+, and about 0.5 mag less at NELM 5.0.
- Magnification effects in the formula:
  - Increasing M at fixed D raises LM through the `δmin/p` term: about 2.1 mag per decade of exit-pupil decrease when d < p.
  - When d > p, LM grows as `5·log(M·p)`, because the effective aperture is M·p.

### 6.5 Alternative: Clark (1990) / Mel Bartels / DeepskyLog "contrast reserve"
Same idea, but uses Blackwell's table directly:
- Eyepiece sky: `µ_a = SQM − 5·log10(2.833·D_inch) + 5·log10(M)`.
- Apparent size: minor axis × M, in arcmin.
- Object contrast: `logC = −0.4·(µ_obj_arcmin² − SQM_arcmin²)`.
- The threshold `logC_th` is bilinearly interpolated in a 24×7 table:
  - rows: µ_a = 4…27;
  - columns: log10(size′) = −0.2255, 0.5563, 0.9859, 1.260, 1.742, 2.083, 2.556, which are Blackwell's 0.595′, 3.6′, 9.68′, 18.2′, 55.2′, 121′ and 360′ targets.
- Rating bins (DeepskyLog):

| contrast reserve | label |
|---|---|
| < −0.2 | not visible |
| −0.2…0.1 | questionable |
| 0.1…0.35 | difficult |
| 0.35…0.5 | quite difficult |
| 0.5…1.0 | easy |
| ≥ 1.0 | very easy |

- Implementation: https://github.com/DeepskyLog/pydeepskylog (`contrast_reserve.py`, `config.py`).
  - The package is GPLv3: re-derive, don't copy code.
  - Blackwell's numbers themselves are 1946 published data. Rows 18–25 of the table are reproduced in Appendix A.
- Crumey is preferred: it is continuous, physically based on B, handles exit pupil vs eye pupil properly, and gives the stellar LM from the same constants. Use Clark's table as a cross-check.

---

## 7. Specific object classes

### 7.1 Extended objects: catalogue size problem
- Catalogue sizes are measured to about the 25 mag/arcsec² isophote, which is fainter than the eye can reach. For example, Crumey finds M33's visible radius is 18.7′, versus a catalogue radius of 25.3′.
- For **galaxies and globular clusters**, evaluate two versions and take the max margin:
  - "whole": catalogue a × b and m;
  - "core": 0.3·a × 0.3·b and m + 1.0 (about 40% of the light in the inner region).
- Report which one won: "only the core will show" vs "the full oval".
- For **planetary nebulae, emission and reflection nebulae, and open-cluster glow**, use catalogue values directly.
- Emission/PN colour: Crumey §1.3 warns that non-blackbody spectra need a scotopic correction. OIII/Hβ-dominated PNe are green and well matched to rods, so a small bonus of about −0.2 mag can be applied. Hα-red nebulae are penalised by about +0.5 to +1 mag (rods are blind to Hα).

### 7.2 "Too small" (looks stellar)
- Apparent major axis `M·a`:
  - below about **8′**: "looks like a star at this magnification";
  - **8–20′**: "small fuzzy spot".
- Basis: Blackwell's critical visual angle is about 4.5′ radius at dark-sky levels (Crumey §3.1), and Clark recommends magnifying detail to about 1° or more apparent.
- In the "looks stellar" case, visibility is governed by the point-source limit: compare `m + kX` with LM.

### 7.3 (c) Double stars
Inputs: separation ρ (arcsec), component magnitudes m1 ≤ m2, Δm = m2 − m1.
```
ρ_eye   = 240″ (bright pairs, both ≥ 2 mag above LM)   — AL: 10×50 splits 4th-mag pairs at ~24″ (= 4′ apparent)
          S&T rule: minimum split magnification ≈ 300/ρ″, comfortable ≈ 480/ρ″, best ≈ 750/ρ″
f_dm    = 1 + 0.25·Δm   (Δm ≤ 4; heuristic, consistent with "Δm > 2 is much harder")
f_faint = 1 + 0.5·max(0, m2 − (LM − 2))     (companion near threshold gets harder)
ρ_req   = max( ρ_eye · f_dm · f_faint · s_res / M ,  116/D_mm  ,  2″ seeing floor )
split   = ρ / ρ_req ;  companion visible iff m2 + kX < LM − 0.5
```
- Rating bins:
  - split ≥ 2: easy, clean split;
  - 1.3–2: clear split;
  - 1.0–1.3: tight split, needs steady view;
  - 0.8–1.0: elongated/notched only;
  - < 0.8: not split.
- Also report the "wide pair" case. If ρ > 0.6 × true field radius, the pair doesn't fit the field together.
- Unequal-pair literature: Chris Lord's aperture–separation–Δm relation (S&T Jan 2002 p.120), Treanor 1946, Peterson. These are for telescope (diffraction-limited) regimes. In binoculars the limit is the eye's resolution at the apparent scale, so the f_dm heuristic above stands in for them.
- Checks with a 10x50 on a tripod, LM ≈ 10:
  - Albireo (34.4″, 3.1/5.1, Δm 2.0): ρ_req = 240·1.5/10 = 36″, split = 0.96. "Elongated/borderline on a tripod; not split hand-held (ρ_req 63″)". This matches common reports that it is just split in steady 10x50s and easy at 15x.
  - Mizar A–B (14.4″, 2.3/4.0): ρ_req ≈ 34″, so not split. Mizar–Alcor (708″) is trivial.
  - ν Dra (62″, 4.9/4.9): easy. ζ Lyr (44″, 4.3/5.6): ρ_req 32″, clear split. δ Cep (41″, Δm 2): ρ_req 36″, split.

### 7.4 (d) Clusters: resolved vs glow
There is no single standard metric. Recommended composite:
1. **Glow detectability:** the extended margin VM from §6 with integrated m and size (core variant for globulars).
2. **Resolution depth:** `ΔR = LM − m_brightest` (m_brightest = magnitude of the brightest member, e.g. from the Sky Catalogue 2000 / NGC 2000 / WEBDA "brightest star" column).
   - For globulars, use the brightest giants (M13 ≈ 11.9, M4 ≈ 10.8, M22 ≈ 10.7, ω Cen ≈ 11.5, 47 Tuc ≈ 11.7) or the horizontal branch +3 mag.
   - Bins:
     - ΔR < 0: "unresolved glow" (a "fuzzy star" for globulars);
     - 0–1: "a few stars sparkle in/at the edge of the glow";
     - 1–2.5: "partly resolved, grainy";
     - > 2.5: "well resolved".
3. **Crowding check:**
   - Estimate the number of members brighter than LM−0.5 as `N ≈ N_total · 10^(0.3·(LM − 0.5 − m_brightest)) / 10^(0.3·Δ_cat)`. Simpler: use the catalogue member count and assume a uniform luminance function, capped at N_total.
   - Mean apparent spacing: `s_app = M · sqrt(π/4·a·b / N)` (arcmin). If s_app < 2.5′, downgrade one level ("stars merge into mottled glow").
   - The Trumpler concentration class (I = concentrated … IV = scattered) can modulate the downgrade.
4. Checks with a 10x50 at Bortle 3 (LM 10.35):
   - M13: ΔR = −1.5, so "unresolved fuzzy ball" with a good glow margin of +1.1. Correct.
   - M45: ΔR > 7, "fully resolved", but 110′ is large; fits a 6.5° field.
   - M44 (brightest 6.3): well resolved.
   - M35 (brightest ~7.5): partly to well resolved, grainy.

---

## 8. Rating and reasons

### 8.1 Five levels from the extended margin VM (log contrast units; divide by 0.4 for magnitudes)

| VM | Rating | Plain English |
|---|---|---|
| ≥ 0.8 | Excellent | Obvious at a glance. |
| 0.4 – 0.8 | Good | Easy once you're pointed at it. |
| 0.15 – 0.4 | Fair | Visible with direct vision; faint. |
| −0.15 – 0.15 | Difficult | Averted vision, patience, steady view needed; may not be seen. |
| < −0.15 | Not visible | Below what a typical eye can detect tonight. |

- For "looks stellar" objects, use `VM_star = 0.4·(LM − (m + kX))` and the same bins.
- Doubles use the split bins (§7.3). Clusters use `max(glow rating, resolution rating)` with the resolution text.
- Shift all bins by `0.4·2.5·log10(F/2)` if the user calibrated F.

### 8.2 Reasons by counterfactual attribution
Compute VM for tonight, then recompute with one factor idealised at a time:

| Counterfactual | Change | Reason text if ΔVM ≥ 0.15 (largest first) |
|---|---|---|
| no Moon | B_moon = 0 | "Washed out by the Moon (X% lit, Y° away)" |
| dark site | µ_zen = 21.9 | "Light pollution hides it — needs a darker sky" |
| clear air | s_aer = 0.3 | "Haze/smoke is dimming it" |
| overhead | alt = 90° | "Too low in the sky — wait until it rises higher" |
| steady | F_S = 1 | "Hand-shake — brace or use a tripod" |

Intrinsic reasons when the object is still not Good even with all counterfactuals applied. Pick by regime: compare `A_a` with the eyepiece Ricco area `A_TR,a = R_a / C_a`.
- `A_a < 0.3·A_TR,a` (point-like regime) and m + kX > LM: "**Too faint overall** for 50 mm".
- `A_a > 3·A_TR,a` (surface-brightness regime) and µ_obj is the limiter: "**Surface brightness too low** — light too spread out". Suggest smaller magnification or a darker sky.
- Apparent size < 8′: "**Too small** at 10x — looks like a star".
- Double ρ < ρ_req: "**Too close** to split at 10x" (suggest the M needed: `ρ_eye·f/ρ`).
- Cluster ΔR < 0: "**Stars too faint** to resolve — shows as a glow".
- Object bigger than the field (a > 0.8·field): "**Too big** for the field — sweep around it".

---

## 9. Sanity-check numbers

Setup: 10x50, p = 6 mm, t = 0.85, F = 2, F_T = 1, tripod. Elevation 300 m, average transparency (k = 0.254). Object altitude 60° (X = 1.155). Moon case: 50% illuminated (α = 90°) at 40° from the object, Moon altitude 50°.
VM is shown as the best of the whole/core variants.

| | B3 no Moon | B3 + Moon | B7 no Moon | B7 + Moon |
|---|---|---|---|---|
| µ_sky at object | 21.34 | 20.01 | 18.14 | 18.01 |
| LM tripod / IS / hand | 10.35 / 10.25 / 9.90 | 9.83 / 9.73 / 9.38 | 9.22 / 9.12 / 8.77 | 9.18 / 9.08 / 8.73 |
| M31 (3.4, 190×60′) | +0.99 Excellent (whole +0.44) | +0.64 Good | +0.15 Fair (core only) | +0.12 Difficult |
| M33 (5.7, 71×42′) | +0.54 Good | +0.21 Fair | −0.25 Not visible | −0.28 Not visible |
| M81 (6.9, 27×14′) | +0.57 Good | +0.28 Fair | −0.11 Difficult | −0.13 Difficult |
| M13 (5.8, 16.6′) | +1.08 Excellent glow, unresolved | +0.80 | +0.42 Good | +0.40 Fair/Good |
| M57 (8.8, 1.4×1.0′) | +0.54, but 14′ apparent: looks like a star | +0.32 | +0.04 | +0.02 |
| M45 glow (1.6, 110′) | +1.71 + fully resolved | +1.35 | +0.86 | +0.83 |
| M51 (8.4, 11×7′) | +0.21 Fair | −0.05 Difficult | −0.38 Not visible | −0.40 |
| M101 (7.9, 29×27′) | +0.05 Difficult | −0.25 Not visible | −0.67 | −0.70 |
| M27 (7.4, 8×5.7′) | +0.73 Good | +0.43 | +0.09 Difficult | +0.07 |
| Albireo | split 0.96 tripod (borderline), 0.55 hand-held | same | same (LM not limiting) | same |
| Mizar A–B / Mizar–Alcor | not split / trivially split | | | |

These agree with typical experience:
- M31 is obvious from dark sites, and only the core shows in suburbs.
- M33 vanishes in suburbs. M101 is a hard binocular target even from the country.
- M13 is a fuzzy star everywhere.
- The Moon costs about 1.3 mag/arcsec² at 40° separation for a 50% Moon at a Bortle 3 site, but almost nothing at Bortle 7.

---

## 10. Asking users about conditions (map to SQM / transparency)

### Sky darkness: ask 2–3 questions and take the most informative answer

1. **Where are you?**
   | Answer | SQM |
   |---|---|
   | city centre | 17.5 |
   | city/large town | 18.2 |
   | suburb | 19.3 |
   | edge of town / village | 20.3 |
   | countryside | 21.2 |
   | remote / dark-sky park | 21.8 |
2. **Can you see the Milky Way?**
   | Answer | SQM |
   |---|---|
   | no / never | ≤ 18.5 |
   | only a faint band overhead when looking hard | 19.5 |
   | clearly, but no detail | 20.6 |
   | bright, with dark lanes (Great Rift) and structure | 21.4 |
   | casts shadows / zodiacal light obvious | 21.8 |
3. **How many stars of the Little Dipper can you see?** Stars: Polaris 2.0, Kochab 2.1, Pherkad 3.0, ε 4.2, ζ 4.3, δ 4.4, η 5.0. The answer gives NELM; convert with the empirical Unihedron inverse `SQM = 21.58 − 5·log10(10^(1.586 − NELM/5) − 1)`. Don't use Crumey eq B1 here: it is optimistic in bright skies (see §6.2).
   | Stars seen | NELM | SQM (approx.) |
   |---|---|---|
   | 2 | ~2.8 | ~16.7 |
   | 3 | ~3.6 | ~17.6 |
   | 4–6 | ~4.4 | ~18.5 |
   | all 7 | ~5.0 | ~19.3 |
   | 7 plus fainter stars inside the bowl | ≥ 5.8 | ≥ 20.5 |
4. (Alternative, autumn/winter) **How many Pleiades stars?**
   | Stars seen | NELM | SQM |
   |---|---|---|
   | 0–3 | ≤ 4.2 | ≤ 18.3 |
   | 4–5 | ~4.8 | ~19.0 |
   | 6 | ~5.6 | ~20.2 |
   | 7–9 | ~6.3 | ~21.3 |
   | 10+ | ≥ 6.7 | 21.9 (cap) |
5. Or directly: Bortle class, SQM reading, or a light-pollution-map value (e.g. lightpollutionmap.info SQM/Bortle at the site).

Combine by taking the median of the answered estimates. If the user enters both a measured SQM and a star count, fit F instead (§2.2).

### Transparency (haze): map to 1–5 when no AOD is available
- **Daytime sky colour near the horizon?** Deep blue = 1–2; pale blue = 3; milky white = 4; brown/grey/smoky = 5.
- **Can you see stars right down to the horizon?** Yes, to within a few degrees = 1–2; lose them below ~20° = 3; below ~40° = 4.
- **Halos around streetlights or the Moon?** Yes = at least 4.
- **Humidity/dew forming quickly?** Yes adds +1, capped at 5.

---

## 11. Implementation notes

- Pure functions; all inputs explicit; unit-test against:
  - K&S Table 2: 99 nL at α = 90°, ρ = 60°, Z_m = 60°, k = 0.172;
  - Crumey naked-eye m0 = 6.18 at µ = 21.83, F = 2;
  - Crumey telescope `m_cut = 5·log D_cm + 8.45 − 2.5·log F`;
  - the table in §9.
- Compute B_a with a floor of 1e−5 cd/m². For µ_sky < 16 (bright twilight or the Moon very close), return "sky too bright" rather than extrapolating.
- For object magnitude, prefer V. Many NGC values are photographic B: if only B is available, use V ≈ B − 0.8 for galaxies and B − 0.3 for clusters.
- Optimal magnification is out of scope for binoculars, but the same functions let you compare two binoculars (e.g. 10x50 vs 15x70) for "which to bring".

Pseudocode (TypeScript-like):
```ts
const muToCd = (mu: number) => 10 ** (-0.4 * (mu - 12.58));
const luxToMag = (I: number) => -2.5 * Math.log10(I) - 13.99;
function threshold(Ba: number, Aa_sr: number, phi: number, q = 0.6) {
  const x = Math.max(Ba, 1e-5) ** -0.25;
  const R = (6.505e-4 * x - 8.461e-4) ** 2, Cinf = 7.633e-3 * x - 7.174e-3;
  return phi * ((R / Aa_sr) ** q + Cinf ** q) ** (1 / q);
}
function limitingMag(muSky: number, D: number, M: number, p: number, t: number, phi: number, kX: number) {
  const d = D / M, lo = Math.min(d, p), hi = Math.max(d, p), Ft = 1 / t;
  const Ba = Math.max((lo / p) ** 2 * muToCd(muSky) / Ft, 1e-5);
  const dIa = phi * (6.505e-4 * Ba ** 0.25 - 8.461e-4 * Ba ** 0.5) ** 2;
  return luxToMag((hi / D) ** 2 * Ft * dIa) - kX;
}
function margin(m: number, aAm: number, bAm: number, muSky: number, D: number, M: number,
                p: number, t: number, phi: number, kX: number) {
  const areaAm2 = Math.PI / 4 * aAm * bAm;
  const muObj = m + kX + 2.5 * Math.log10(areaAm2 * 3600);
  const B = muToCd(muSky), Cobj = muToCd(muObj) / B;
  const d = D / M, Ba = Math.max((Math.min(d, p) / p) ** 2 * B * t, 1e-5);
  const Aa = areaAm2 * M * M / 3437.75 ** 2;
  return Math.log10(Cobj / threshold(Ba, Aa, phi));
}
```

---

## Appendix A: Blackwell/Clark log-threshold-contrast table (as used by DeepskyLog)

Rows: eyepiece sky µ_a. Columns: log10(apparent diameter in arcmin) = −0.2255, 0.5563, 0.9859, 1.260, 1.742, 2.083, 2.556.

```
18:  1.8559  0.3458 -0.4924 -0.8561 -1.2661 -1.4721 -1.6624
19:  2.2669  0.6960 -0.1315 -0.5510 -1.0562 -1.2892 -1.4827
20:  2.6760  1.0880  0.2060 -0.3210 -0.8800 -1.1370 -1.3620
21:  2.7766  1.2065  0.3467 -0.1377 -0.7361 -0.9964 -1.2439
22:  2.9304  1.3821  0.5353  0.0328 -0.5605 -0.8606 -1.1187
23:  3.1634  1.6107  0.7708  0.2531 -0.3895 -0.7030 -0.9681
24:  3.4643  1.9034  1.0338  0.4943 -0.2033 -0.5259 -0.8288
25:  3.8211  2.2564  1.3265  0.7605  0.0172 -0.2992 -0.6394
```
Rows 4–17 and 26–27 are in pydeepskylog `config.py`.

---

## Sources

- Crumey, A. 2014, "Human contrast threshold and astronomical visibility", MNRAS 442, 2600. https://arxiv.org/abs/1405.4209 · PDF https://crumey.co.uk/astronomy/mnras.pdf · author page https://crumey.co.uk/astronomy/astro.html
- Krisciunas, K. & Schaefer, B. E. 1991, "A model of the brightness of moonlight", PASP 103, 1033. https://ui.adsabs.harvard.edu/abs/1991PASP..103.1033K (scan: https://cta-redmine.irap.omp.eu/attachments/download/3619/1991PASP__103_1033K.pdf). Python implementation: https://specsim.readthedocs.io/en/latest/api/specsim.atmosphere.krisciunas_schaefer.html
- Green, D. W. E. 1992, "Magnitude corrections for atmospheric extinction", ICQ 14, 55. http://www.icq.eps.harvard.edu/ICQExtinct.html
- Schaefer, B. E. 1990, "Telescopic limiting magnitudes", PASP 102, 212. https://ui.adsabs.harvard.edu/abs/1990PASP..102..212S
- Blackwell, H. R. 1946, "Contrast thresholds of the human eye", JOSA 36, 624. https://doi.org/10.1364/JOSA.36.000624
- Clark, R. N. 1990, *Visual Astronomy of the Deep Sky* (CUP/Sky Publishing). https://clarkvision.com/articles/visastro/ and https://clarkvision.com/visastro/m51-mag
- DeepskyLog / pydeepskylog (contrast reserve, Bortle/NELM/SQM maps, GPLv3): https://github.com/DeepskyLog/pydeepskylog · https://pypi.org/project/pydeepskylog
- Bortle scale table: https://en.wikipedia.org/wiki/Bortle_scale
- NELM↔SQM: Unihedron https://unihedron.com/projects/darksky/NELM2BCalc.html · JAAVSO 42 (2014) https://app.aavso.org/jaavso/article/2976/
- Ed Zarenski et al., "Limiting Magnitude in Binoculars" thread (2003): https://groups.google.com/g/sci.astro.amateur/c/lnNnaKYXE8g
- Hand-held vs IS vs tripod resolution test (Canon 10x42 IS L): https://www.birdforum.net/threads/canon-10x42-is-l-tripod-vs-hand-held-vs-is-testing.297776 and https://www.birdforum.net/goto/post?id=3149378
- Sky at Night on stabilised binoculars: https://www.skyatnightmagazine.com/advice/hold-steady-the-virtues-of-image-stabilising-binoculars
- Double-star rules: Astronomical League Binocular Double Star program https://www.astroleague.org/wp-content/uploads/2024/04/Binocular-Double-Stars-D.pdf · S&T "Pretty double stars for everyone" https://skyandtelescope.org/observing/pretty-double-stars-for-everyone · Lord's unequal-doubles work, S&T Jan 2002 p.120, summarized at https://skyandtelescope.org/observing/pushing-limits-a-spring-sky-double-star-romp/
- Riccò's law / limiting magnitude background: https://en.wikipedia.org/wiki/Ricco%27s_law · https://en.wikipedia.org/wiki/Limiting_magnitude
- Kasten, F. & Young, A. T. 1989, Applied Optics 28, 4735 (airmass).
- Open-Meteo Air Quality API (CAMS aerosol_optical_depth, dust): https://open-meteo.com/en/docs/air-quality-api · Weather API (visibility, relative_humidity_2m): https://open-meteo.com/en/docs

### Confidence notes
- **High:** Crumey constants and equations (read directly from the arXiv text); K&S equations (read from the scanned paper, checked against its Table 2); Green extinction terms (read from the ICQ page); Bortle table (Wikipedia).
- **Medium:**
  - binocular LM agreement with Zarenski's field data;
  - the AOD→k and visibility→k mappings (standard physics; constants approximate);
  - the core/whole galaxy heuristic.
- **Low (engineering heuristics, tune with user feedback):**
  - hand-held/IS penalties (only one bar-target test plus anecdotes found; no controlled limiting-magnitude study);
  - the unequal-double factor f_dm;
  - cluster crowding thresholds;
  - light-pollution horizon/haze multipliers;
  - colour corrections for nebulae.
