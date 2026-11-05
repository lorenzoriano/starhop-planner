/**
 * Small helpers for the Sky Journeys KB build (script/journeys/build_kb.ts): JSON I/O with stable formatting,
 * structural equality, key ordering. No dependencies beyond node:fs / node:crypto.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Obj = Record<string, unknown>;

export const readJson = <T = unknown>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
export const readJsonIfExists = <T = unknown>(path: string): T | null => (existsSync(path) ? readJson<T>(path) : null);

/** Pretty JSON (1-space indent, trailing newline): diffs stay line-oriented and the files stay small. */
export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 1)}\n`);
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

export const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

/** JSON with object keys sorted at every level (structural identity, independent of key order). */
export function canonical(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) => {
    if (!isObj(v)) return v;
    const out: Obj = {};
    for (const k of Object.keys(v).sort()) out[k] = v[k];
    return out;
  });
}

export const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** New object with `order` keys first (when present), then the remaining keys in their existing order. */
export function orderKeys<T extends Obj>(o: T, order: readonly string[]): T {
  const out: Obj = {};
  for (const k of order) if (o[k] !== undefined) out[k] = o[k];
  for (const k of Object.keys(o)) if (!(k in out) && o[k] !== undefined) out[k] = o[k];
  return out as T;
}

export const uniq = <T>(xs: Iterable<T>): T[] => Array.from(new Set(xs));

export const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Group-and-count helper for the report. */
export function countBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return new Map(Array.from(m.entries()).sort((a, b) => byString(a[0], b[0])));
}
