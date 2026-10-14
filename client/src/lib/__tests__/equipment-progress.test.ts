import { describe, expect, it } from "vitest";
import { eyepieceField } from "../eyepiece";
import { parseHopProgress, matchingRouteIndex, routeFingerprint, type HopProgress } from "../hop-progress";
import type { Route } from "../astronomy";

describe("eyepiece estimates", () => {
  it("calculates the 1200 mm / 24 mm / 68 degree example", () => {
    expect(eyepieceField(1200, 24, 68)).toEqual({ magnification:50, trueField:1.36 });
    expect(eyepieceField(600, 24, 68)?.trueField).toBe(2.72);
  });
  it("rejects missing, negative, nonfinite and impossible optical inputs", () => {
    for (const args of [[0,24,68],[1200,-1,68],[1200,24,181],[Infinity,24,68],[1200,NaN,68]]) expect(eyepieceField(...args as [number,number,number])).toBeNull();
  });
});
const route = { id:"route-1", startAnchor:{id:"HR337"}, target:{id:"M31"}, strategyId:"landmark-discount", hops:[{center:{ra:1,dec:35}},{center:{ra:2,dec:40}}] } as Route;
const now = 10_000_000;
const progress: HopProgress = { configKey:"site/time/equipment", algorithm:"auto", fingerprint:routeFingerprint(route), step:1, savedAt:now, live:true };
describe("bounded hop continuity", () => {
  it("matches physical paths despite route ranking changes", () => {
    const changedRank = { ...route, id:"route-3", score:99 };
    expect(matchingRouteIndex([changedRank],progress)).toBe(0);
    expect(matchingRouteIndex([{...route,hops:[{...route.hops[0],center:{...route.hops[0].center,ra:1.01}},route.hops[1]]}],progress)).toBe(-1);
    expect(matchingRouteIndex([{...route,target:{...route.target,id:"M33"}}],progress)).toBe(-1);
    expect(matchingRouteIndex([route],{...progress,step:2})).toBe(-1);
  });
  it("expires old live routes but retains explicitly planned skies", () => {
    expect(parseHopProgress(JSON.stringify(progress),now)).toEqual(progress);
    const later=now+8*60*60*1000+1;
    expect(parseHopProgress(JSON.stringify(progress),later)).toBeNull();
    expect(parseHopProgress(JSON.stringify({...progress,live:false}),later)).not.toBeNull();
  });
  it("ignores corrupt, unbounded and future-dated storage", () => {
    for (const raw of [null,"{broken}","x".repeat(16001),JSON.stringify({...progress,step:-1}),JSON.stringify({...progress,algorithm:"unknown"}),JSON.stringify({...progress,savedAt:now+120_000})]) expect(parseHopProgress(raw,now)).toBeNull();
  });
});
