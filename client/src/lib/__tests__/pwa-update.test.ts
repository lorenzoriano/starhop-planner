import { describe, expect, it } from "vitest";
import {
  appendHistory,
  buildOfCacheKey,
  cachesToDelete,
  carryOverPaths,
  isBulkAsset,
  isPageStale,
} from "../sw-logic";
import { JUST_LAUNCHED_MS, UPDATE_CHECK_INTERVAL_MS, shouldCheckForUpdate, updateAction } from "../pwa-update";

const PREFIX = "starhop-%2Fstarhop-planner%2F-";
const A = "aaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbb";
const C = "cccccccccccccccc";
const D = "dddddddddddddddd";
const key = (build: string) => `${PREFIX}${build}`;

describe("isBulkAsset", () => {
  it("defers photographs and the lunar atlas but not catalogs or bundles", () => {
    expect(isBulkAsset("./data/binocular-images/m31.jpg")).toBe(true);
    expect(isBulkAsset("./data/journey-images/x/y.webp")).toBe(true);
    expect(isBulkAsset("./data/finder-stars/tile-1.json")).toBe(true);
    expect(isBulkAsset("./data/moon/features/tycho.jpg")).toBe(true);
    expect(isBulkAsset("./data/moon/lroc-gray-2k.jpg")).toBe(true);
    expect(isBulkAsset("./data/moon/features.json")).toBe(false);
    expect(isBulkAsset("./data/bsc5-short.json")).toBe(false);
    expect(isBulkAsset("./assets/index-abc.js")).toBe(false);
  });
});

describe("buildOfCacheKey", () => {
  it("only recognises this scope's build caches", () => {
    expect(buildOfCacheKey(key(A), PREFIX)).toBe(A);
    expect(buildOfCacheKey(`${PREFIX}meta`, PREFIX)).toBeUndefined();
    expect(buildOfCacheKey(`starhop-%2Fother%2F-${A}`, PREFIX)).toBeUndefined();
    expect(buildOfCacheKey(`${PREFIX}ABCDEF0123456789`, PREFIX)).toBeUndefined();
  });
});

describe("carryOverPaths", () => {
  const previous = {
    build: A,
    files: ["./index.html", "./data/binocular-images/a.jpg", "./data/binocular-images/b.jpg", "./data/journey-images/c.jpg"],
    sizes: { "./index.html": 10, "./data/binocular-images/a.jpg": 100, "./data/binocular-images/b.jpg": 200, "./data/journey-images/c.jpg": 300 },
  };
  it("keeps unchanged photos that the new build still lists", () => {
    const next = {
      build: B,
      files: ["./index.html", "./data/binocular-images/a.jpg", "./data/binocular-images/b.jpg", "./data/journey-images/new.jpg"],
      sizes: { "./index.html": 11, "./data/binocular-images/a.jpg": 100, "./data/binocular-images/b.jpg": 250, "./data/journey-images/new.jpg": 5 },
    };
    // b changed size, c was removed, new.jpg did not exist, index.html is not bulk.
    expect(carryOverPaths(previous, next)).toEqual(["./data/binocular-images/a.jpg"]);
  });
  it("trusts nothing without sizes or a previous manifest", () => {
    const next = { build: B, files: previous.files, sizes: previous.sizes };
    expect(carryOverPaths(null, next)).toEqual([]);
    expect(carryOverPaths({ files: previous.files }, next)).toEqual([]);
    expect(carryOverPaths(previous, { files: previous.files })).toEqual([]);
  });
});

describe("build history and stale pages", () => {
  it("appends without duplicates and bounds its length", () => {
    expect(appendHistory([A, B], A)).toEqual([B, A]);
    expect(appendHistory([A, B, C], D, 3)).toEqual([B, C, D]);
  });
  it("flags only pages running a build this worker replaced", () => {
    expect(isPageStale(A, B, [A, B])).toBe(true);
    expect(isPageStale(B, B, [A, B])).toBe(false);
    // A page newer than the worker waits for the worker to update instead.
    expect(isPageStale(C, B, [A, B])).toBe(false);
    expect(isPageStale(undefined, B, [A, B])).toBe(false);
  });
});

describe("cachesToDelete", () => {
  const keys = [key(A), key(B), key(C), `${PREFIX}meta`, "unrelated"];
  const base = { keys, prefix: PREFIX, currentBuild: C, history: [A, B, C] };
  it("deletes previous builds once no open page runs them", () => {
    expect(cachesToDelete({ ...base, clientBuilds: [] })).toEqual([key(A), key(B)]);
    expect(cachesToDelete({ ...base, clientBuilds: [C, C] })).toEqual([key(A), key(B)]);
  });
  it("keeps a previous build while a page still runs it", () => {
    expect(cachesToDelete({ ...base, clientBuilds: [C, A] })).toEqual([key(B)]);
  });
  it("keeps everything while some page has not reported its build", () => {
    expect(cachesToDelete({ ...base, clientBuilds: [C, undefined] })).toEqual([]);
  });
  it("caps retained caches, dropping the oldest first", () => {
    expect(cachesToDelete({ ...base, clientBuilds: [undefined], maxRetained: 1 })).toEqual([key(A)]);
    // Builds missing from history count as the oldest.
    expect(cachesToDelete({ ...base, history: [B, C], clientBuilds: [undefined], maxRetained: 1, includeUnknownBuilds: true })).toEqual([key(A)]);
  });
  it("never deletes a newer build's cache (it may be installing)", () => {
    // Worker B still serves pages while C installs: C is not in history yet.
    expect(cachesToDelete({ ...base, currentBuild: B, history: [A, B], clientBuilds: [B] })).toEqual([key(A)]);
    // A worker never deletes builds activated after its own.
    expect(cachesToDelete({ ...base, currentBuild: B, history: [A, B, C], clientBuilds: [] })).toEqual([key(A)]);
  });
  it("deletes caches unknown to the history only when allowed", () => {
    const pre = { ...base, history: [C], clientBuilds: [] };
    expect(cachesToDelete(pre)).toEqual([]);
    expect(cachesToDelete({ ...pre, includeUnknownBuilds: true })).toEqual([key(A), key(B)]);
  });
  it("never touches the current build, bookkeeping or foreign caches", () => {
    const doomed = cachesToDelete({ ...base, clientBuilds: [], maxRetained: 0 });
    expect(doomed).not.toContain(key(C));
    expect(doomed).not.toContain(`${PREFIX}meta`);
    expect(doomed).not.toContain("unrelated");
  });
});

describe("update checks and reloads", () => {
  it("throttles update checks", () => {
    expect(shouldCheckForUpdate(1_000, 0)).toBe(false);
    expect(shouldCheckForUpdate(UPDATE_CHECK_INTERVAL_MS, 0)).toBe(true);
  });
  const ctx = { hidden: false, sinceLoadMs: 60_000, busy: false, alreadyAutoReloaded: false };
  it("reloads silently when hidden or just launched", () => {
    expect(updateAction({ ...ctx, hidden: true })).toBe("reload");
    expect(updateAction({ ...ctx, sinceLoadMs: JUST_LAUNCHED_MS - 1 })).toBe("reload");
  });
  it("asks while the page is in use", () => {
    expect(updateAction(ctx)).toBe("prompt");
  });
  it("never interrupts a playing hop animation or loops reloading", () => {
    expect(updateAction({ ...ctx, hidden: true, busy: true })).toBe("prompt");
    expect(updateAction({ ...ctx, hidden: true, alreadyAutoReloaded: true })).toBe("prompt");
  });
});
