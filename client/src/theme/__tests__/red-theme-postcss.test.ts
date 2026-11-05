import { describe, expect, it } from "vitest";
import postcss from "postcss";
import redTheme, { mapColour, mapDeclaration, SURFACE_CAP, TEXT } from "../red-theme-postcss.js";

const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (r: number) => 0.2126 * lin(r);
const contrast = (a: number, b: number) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const run = (css: string) => postcss([redTheme()]).process(css, { from: undefined }).css;
const reds = (css: string) => [...css.matchAll(/rgb\((\d+) (\d+) (\d+)/g)].map((m) => [+m[1], +m[2], +m[3]]);

describe("red-light theme plugin", () => {
  it("maps text to full red and keeps >= 4.5:1 on the brightest surface", () => {
    expect(mapColour([150, 160, 170], 1, "text")).toBe(TEXT);
    expect(mapColour([10, 10, 10], 0.6, "text")).toBe(TEXT);
    expect(contrast(255, SURFACE_CAP)).toBeGreaterThanOrEqual(4.5);
  });

  it("sinks every surface, even a light fill, to the dark ladder (effective, after alpha)", () => {
    expect(mapColour([230, 230, 230], 1, "surface")).toBe(`rgb(${SURFACE_CAP} 0 0)`);
    expect(mapColour([8, 19, 27], 1, "surface")).toBe("rgb(18 0 0)");
    const tint = mapColour([255, 255, 255], 0.5, "surface");
    const [, r, a] = tint.match(/rgb\((\d+) 0 0 \/ ([\d.]+)\)/)!;
    expect(+r * +a).toBeLessThanOrEqual(SURFACE_CAP);
  });

  it("emits only pure red (no green or blue) for literal colours of every syntax", () => {
    const out = run(`.a{color:#9db1b8;background:linear-gradient(#102631, rgba(56,189,248,.3));border:1px solid hsl(200 85% 50%);box-shadow:0 0 4px rgb(10 200 30 / 40%)}`);
    const twin = out.slice(out.indexOf("html.red-light .a"));
    expect(twin).toContain("var(--nv-text");
    for (const [, g, b] of reds(twin)) { expect(g).toBe(0); expect(b).toBe(0); }
  });

  it("adds a html.red-light twin right after each coloured rule and leaves the original alone", () => {
    const out = run(`.a{color:#fff;padding:4px}.b{margin:0}`);
    expect(out).toMatch(/^\.a\{color:#fff;padding:4px\}\s*html\.red-light \.a\s*\{\s*color:\s*var\(--nv-text/);
    expect(out).not.toContain("html.red-light .b");
  });

  it("keeps the cascade: border longhands and var() colours are twinned too", () => {
    const out = run(`.a{border:1px solid #333}.a.b{border-left-width:3px;color:var(--x)}`);
    expect(out).toMatch(/html\.red-light \.a\.b\s*\{\s*border-left-width:\s*3px;\s*color:\s*var\(--x\)/);
  });

  it("rescopes rules written for .red-light and maps their filter-era greys", () => {
    const out = run(`.red-light .x{color:#e4e4e4;background:#1a1a1a}`);
    expect(out).toMatch(/^html\.red-light \.x\{color:var\(--nv-text/);
    expect(out).not.toMatch(/(^|[^.\w-])\.red-light/);
  });

  it("maps HSL token triplets by role and leaves var() names untouched", () => {
    expect(mapDeclaration("--background", "225 30% 6%", ":root")).toMatch(/^0 100% [\d.]+%$/);
    expect(mapDeclaration("--foreground", "210 20% 92%", ":root")).toBe("0 100% 50%");
    expect(mapDeclaration("border-left", "3px solid var(--gold, hsl(var(--primary)))", ".x")).toBe("3px solid var(--gold, hsl(var(--primary)))");
    expect(run(`:root{--gold:#d8bc80}`)).toMatch(/html\.red-light\s*\{\s*--gold:\s*rgb\(255 0 0\)/);
  });

  it("keeps faded text opaque in red light and skips keyframes", () => {
    const out = run(`.cap{color:#ddd;opacity:.6}@keyframes k{to{color:#0f0}}`);
    expect(out).toMatch(/html\.red-light \.cap\s*\{[^}]*opacity:\s*1/);
    expect(out).not.toMatch(/html\.red-light to/);
  });
});
