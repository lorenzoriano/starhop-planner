/**
 * PostCSS plugin: derive the red-light (night vision) theme from every stylesheet.
 *
 * Red light used to be a whole-page SVG filter (luminance -> red, then dimmed), which capped the
 * best possible contrast at about 2.4:1. Now each rule that sets a colour gets a twin scoped to
 * `html.red-light` whose colours are pure red (G = B = 0) on a near-black luminance ladder:
 *
 *   text      -> full red (var(--nv-text)), opaque: 5.2:1 on black, >= 4.5:1 on every surface
 *   surfaces  -> the colour's grey-equivalent lightness as red, capped at R = 40 (effective, after
 *                alpha), so text stays >= 4.5:1 on any background and nothing large glows
 *   lines     -> lightness kept (borders, strokes, chart marks, glows), so structure still reads
 *
 * Twins sit right after the rule they mirror and every selector gains the same (0,1,1), so the
 * cascade between rules is unchanged. Rules already written for `.red-light` are rescoped to
 * `html.red-light` and mapped in place; rules already scoped to `html.red-light` are left alone
 * (that is the hand-written base in red-theme.css). Images, canvases and inline-styled SVG
 * colours are handled by the media filters in NightVisionFilter.tsx.
 */

const NAMED = {
  white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], orange: [255, 165, 0], yellow: [255, 255, 0],
  gold: [255, 215, 0], silver: [192, 192, 192], gray: [128, 128, 128], grey: [128, 128, 128], green: [0, 128, 0],
  lime: [0, 255, 0], blue: [0, 0, 255], cyan: [0, 255, 255], aqua: [0, 255, 255], magenta: [255, 0, 255],
  navy: [0, 0, 128], teal: [0, 128, 128], purple: [128, 0, 128], pink: [255, 192, 203], lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211], darkgray: [169, 169, 169], darkgrey: [169, 169, 169], whitesmoke: [245, 245, 245],
  skyblue: [135, 206, 235], gainsboro: [220, 220, 220],
};

/** Effective cap for surfaces: full-red text keeps >= 4.5:1 on anything up to R = 40. */
export const SURFACE_CAP = 40;
export const TEXT = "var(--nv-text, rgb(255 0 0))";

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const enc = (y) => 255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
/** sRGB value of the grey with the same relative luminance as (r, g, b). */
export function greyEquivalent(r, g, b) { return enc(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)); }

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Map one colour for a role. `alpha` is a number, or a string (e.g. "var(--tw-text-opacity, 1)") kept verbatim. */
export function mapColour(rgb, alpha, role) {
  const v = greyEquivalent(rgb[0], rgb[1], rgb[2]);
  const numeric = typeof alpha === "number";
  if (numeric && alpha === 0) return "transparent";
  if (role === "text") {
    if (numeric && alpha < 0.25) return `rgb(${Math.round(Math.max(v, 200))} 0 0 / ${alpha})`;
    return TEXT;
  }
  let r;
  if (role === "surface") {
    const a = numeric ? alpha : 1;
    r = Math.min(v, SURFACE_CAP / Math.max(a, 0.001), 255);
  } else {
    r = v <= 0.5 ? 0 : Math.min(255, Math.max(48, v * 1.35));
  }
  r = Math.round(r);
  if (numeric && alpha >= 1) return `rgb(${r} 0 0)`;
  return `rgb(${r} 0 0 / ${numeric ? +alpha.toFixed(3) : alpha})`;
}

/** Same as mapColour, for an "H S% L%" token, returned as a token (pure red hues only). */
function mapTriplet(rgb, role) {
  const out = mapColour(rgb, 1, role);
  const r = out === TEXT ? 255 : +out.match(/rgb\((\d+)/)[1];
  return `0 100% ${+(r / 255 * 50).toFixed(2)}%`;
}

// Names only as whole tokens: "--gold" or "gold-line" in a var() name must stay untouched.
const COLOUR_RE = /#[0-9a-fA-F]{3,8}(?![\w-])|(?<![\w-])(?:rgba?|hsla?)\((?:[^()]|\([^()]*\))*\)|(?<![\w-])(?:white|black|red|orange|yellow|gold|silver|gr[ae]y|green|lime|blue|cyan|aqua|magenta|navy|teal|purple|pink|light(?:gr[ae]y)|dark(?:gr[ae]y)|whitesmoke|skyblue|gainsboro)(?![\w-])/g;

function parseColour(token) {
  if (token[0] === "#") {
    let h = token.slice(1);
    if (![3, 4, 6, 8].includes(h.length)) return null;
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { rgb: [n(0), n(2), n(4)], alpha: h.length === 8 ? +(n(6) / 255).toFixed(3) : 1 };
  }
  const lower = token.toLowerCase();
  if (NAMED[lower]) return { rgb: NAMED[lower], alpha: 1 };
  const m = token.match(/^(rgba?|hsla?)\((.*)\)$/i);
  if (!m) return null;
  let body = m[2].trim();
  let alpha = 1;
  const slash = body.split("/");
  let parts;
  if (slash.length === 2) { parts = slash[0].trim().split(/[\s,]+/); alpha = slash[1].trim(); }
  else { parts = body.split(/\s*,\s*|\s+/).filter(Boolean); if (parts.length === 4) alpha = parts.pop(); }
  if (parts.length !== 3 || parts.some((p) => /var\(|calc\(|from/.test(p))) return null;
  if (typeof alpha === "string") {
    const t = alpha.trim();
    if (/^[\d.]+%$/.test(t)) alpha = parseFloat(t) / 100;
    else if (/^[\d.]+$/.test(t)) alpha = parseFloat(t);
    else alpha = t;
  }
  const num = parts.map((p) => parseFloat(p));
  if (num.some((x) => Number.isNaN(x))) return null;
  if (m[1].toLowerCase().startsWith("rgb")) return { rgb: parts.map((p, i) => (p.endsWith("%") ? num[i] * 2.55 : num[i])), alpha };
  return { rgb: hslToRgb(num[0], num[1], num[2]), alpha };
}

/** Replace every colour literal in a declaration value (url() segments untouched). */
export function mapValue(value, role) {
  return value.split(/(url\([^)]*\))/).map((seg) => (seg.startsWith("url(") ? seg : seg.replace(COLOUR_RE, (tok) => {
    const c = parseColour(tok);
    return c ? mapColour(c.rgb, c.alpha, role) : tok;
  }))).join("");
}

const TRIPLET_RE = /^\s*(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*$/;

const LINE_PROPS = /^(border|outline|column-rule|text-decoration|stroke|box-shadow|text-shadow|accent-color|stop-color|flood-color|lighting-color|scrollbar-color|-webkit-tap-highlight-color|text-emphasis-color|filter$)/;
const TEXT_PROPS = /^(color|caret-color|-webkit-text-fill-color|-webkit-text-stroke-color)$/;
const SURFACE_PROPS = /^background/;
const FILL_PROPS = /^fill$/;
/**
 * Colour properties and every longhand their shorthands reset. These are cloned even when the value has no
 * literal colour (var(), inherit, widths), so the twins cascade exactly like the originals: a twin of
 * `.a { border: 1px solid #333 }` must not beat an original `.a.b { border-width: 3px }`.
 */
const FAMILY = /^(color|background|border(?!-(radius|collapse|spacing|top-left|top-right|bottom-left|bottom-right|start-start|start-end|end-start|end-end))|outline|text-decoration|column-rule|fill|stroke|caret-color|accent-color|box-shadow|text-shadow|stop-color|-webkit-text-fill-color)/;

/** Small marks that encode data (bars, swatches, dots): keep their lightness instead of sinking them into the surface ladder. */
const MARK_WORDS = new Set(["bar", "fill", "meter", "dot", "swatch", "marker", "segment", "seg", "band", "tick", "progress", "knob", "thumb", "pip", "indicator", "level", "now", "key", "disc", "sw", "pin", "needle", "cursor", "spark"]);
function isMarkSelector(selector) {
  const last = selector.trim().split(/\s*[\s>+~]\s*/).pop() || "";
  if (/::?(before|after|-webkit-slider|-moz-range|-webkit-progress|-webkit-meter|-moz-progress|marker)/.test(last)) return true;
  if (/^i(\b|[.:[])/.test(last)) return true;
  const classes = last.match(/\.[\w-]+/g) || [];
  return classes.some((c) => c.slice(1).split(/[-_]/).some((w) => MARK_WORDS.has(w)));
}
/** `fill` on SVG text (labels, numbers) is text; on shapes it is a line/mark. Judged on the last compound selector. */
function isTextFill(selector) {
  const last = selector.trim().split(/\s*[\s>+~]\s*/).pop() || "";
  if (/^(text|tspan|textPath)\b/.test(last)) return true;
  if (/^(rect|circle|ellipse|path|line|polyline|polygon|g|use)\b/.test(last)) return false;
  const words = (last.match(/\.[\w-]+/g) || []).flatMap((c) => c.slice(1).toLowerCase().split(/[-_]/));
  if (words.some((w) => ["bg", "halo", "box", "plate", "backdrop", "outline", "shape", "disc", "dot"].includes(w))) return false;
  return words.some((w) => ["label", "labels", "text", "caption", "name", "number", "title", "num"].includes(w));
}

/** Role of a custom property from its name. */
export function customRole(name) {
  const n = name.toLowerCase();
  if (/(foreground|-text$|-ink$|-fg$|-mint$|-muted$|-copy$)/.test(n) && n !== "--muted") return "text";
  if (/^--(background|card|popover|secondary|muted|accent|sidebar|sidebar-accent|elevate-\d)$/.test(n)) return "surface";
  if (/(bg|background|panel|surface|shading|glare|offset)/.test(n) && !/border|line|edge/.test(n)) return "surface";
  return "line";
}

function roleFor(prop, selector) {
  if (prop.startsWith("--")) return customRole(prop);
  if (TEXT_PROPS.test(prop)) return "text";
  if (SURFACE_PROPS.test(prop)) return isMarkSelector(selector) ? "line" : "surface";
  if (FILL_PROPS.test(prop)) return isTextFill(selector) ? "text" : "line";
  if (LINE_PROPS.test(prop)) return "line";
  return null;
}

function scopeSelector(sel) {
  const s = sel.trim();
  if (/^html\.red-light\b/.test(s)) return s;
  if (/^:root\.red-light\b/.test(s)) return s.replace(/^:root\.red-light/, "html.red-light");
  if (/^:root\b/.test(s)) return s.replace(/^:root/, "html.red-light");
  if (/^html\b/.test(s)) return s.replace(/^html/, "html.red-light");
  if (/^\.red-light\b/.test(s)) return s.replace(/^\.red-light/, "html.red-light");
  return `html.red-light ${s}`;
}

/** Map one declaration; returns the new value, or null when it carries no colour for red light. */
export function mapDeclaration(prop, value, selector) {
  const role = roleFor(prop, selector);
  if (!role) return null;
  if (prop.startsWith("--")) {
    const t = value.match(TRIPLET_RE);
    if (t) return mapTriplet(hslToRgb(+t[1], +t[2], +t[3]), role);
    const mapped = mapValue(value, role);
    return mapped === value ? null : mapped;
  }
  if (prop === "filter" && !/drop-shadow/.test(value)) return null;
  return mapValue(value, role);
}

function insideKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true;
  return false;
}

const plugin = () => ({
  postcssPlugin: "starhop-red-theme",
  OnceExit(root) {
    const rules = [];
    root.walkRules((rule) => { if (!insideKeyframes(rule)) rules.push(rule); });
    for (const rule of rules) {
      const selectors = rule.selectors;
      if (selectors.every((s) => /^html\.red-light\b/.test(s.trim()))) continue;
      const authoredForRed = selectors.every((s) => /\.red-light\b/.test(s));
      const sel = rule.selector;
      if (authoredForRed) {
        rule.selectors = selectors.map(scopeSelector);
        rule.walkDecls((d) => { const v = mapDeclaration(d.prop, d.value, sel); if (v !== null) d.value = v; });
        continue;
      }
      const twin = rule.clone({ nodes: [] });
      rule.each((d) => {
        if (d.type !== "decl") return;
        const v = mapDeclaration(d.prop, d.value, sel);
        // Unchanged colour-family declarations are kept too, so the twins cascade like the originals.
        if (v !== null && (v !== d.value || FAMILY.test(d.prop))) twin.append(d.clone({ value: v }));
      });
      // Faded text ("opacity: .6" captions) would undo the contrast ladder: text stays opaque in red light.
      const opacity = rule.nodes.find((d) => d.type === "decl" && d.prop === "opacity");
      const textRule = rule.nodes.some((d) => d.type === "decl" && /^(color|font-size|font)$/.test(d.prop));
      if (opacity && textRule && !/disabled|:hover|:focus|:active/.test(sel)) {
        const o = parseFloat(opacity.value);
        if (o >= 0.3 && o < 1) twin.append(opacity.clone({ value: "1" }));
      }
      if (!twin.nodes.length) continue;
      twin.selectors = selectors.map(scopeSelector);
      rule.after(twin);
    }
  },
});
plugin.postcss = true;
export default plugin;
