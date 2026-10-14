import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatInTimeZone } from "date-fns-tz";
import { loadMessier,loadBinocularTargets,loadStars,loadMilkyWay,buildUnifiedTargets,planRoutes,getPlanetPositions,getConstellationGenitive,type UnifiedTarget } from "../astronomy";
import { catalogSearchScore } from "../catalog-search";
import { defaultSettings,settingsSchema,nightListSchema } from "../session";
import { makeSession,suggestSequence } from "../session-planner";
import { moonDay,moonState,targetMoonlight } from "../moon";
import { binocularSample } from "../binocular-guide";
import { pageForPath,pathForPage,targetFromPath } from "../navigation";
import { skyPolygonProjection,milkyWayPaths } from "../sky-polygons";
import { projectChartPoint } from "../chart-view";
import { orientChartPoint } from "../observing";
import { labelFits,boxesOverlap } from "../chart-labels";
import { variableReachAStar } from "../route-planner";
vi.stubGlobal("fetch",async (input:string)=>new Response(readFileSync(resolve(__dirname,"../../../public",input.replace(/^\.\//,"")),"utf8")));
afterAll(()=>vi.unstubAllGlobals());
let targets:UnifiedTarget[];
beforeAll(async()=>{targets=buildUnifiedTargets(await loadMessier(),await loadBinocularTargets());});
const zone="America/Los_Angeles",lat=37.77,lon=-122.42;
describe("verified GitHub feedback",()=>{
 it("uses independently checked J2000 Messier positions, including negative zero declinations",()=>{
  // SEDS / RASC Messier tables: 21h33.5m -00°49′; 00h42.7m +41°16′; 02h42.7m -00°01′.
  expect(targets.find(t=>t.id==="M2")!.dec).toBeCloseTo(-49/60,6);
  expect(targets.find(t=>t.id==="M31")!.ra).toBeCloseTo(42.7/4,6);
  expect(targets.find(t=>t.id==="M77")!.dec).toBeCloseTo(-1/60,6);
 });
 it("migrates misleading IDs without discarding notes or observing timestamps",()=>{
  const at="2026-10-14T03:16:00.000Z";
  const old=["DS-16Cyg","DS-DelCep","AST-IC37"].map(id=>({id,notes:"keep this note",addedAt:at,observedAt:at}));
  const migrated=nightListSchema.parse(old);expect(migrated.map(i=>i.id)).toEqual(["DS-16Dra","DS-OmCep","NGC2169"]);
  expect(migrated.every(i=>i.notes==="keep this note"&&i.observedAt===at)).toBe(true);
  const duplicate=nightListSchema.parse([old[0],{...old[0],id:"DS-16Dra",notes:"a second observation"}]);expect(duplicate).toHaveLength(1);expect(duplicate[0].notes).toContain("keep this note");expect(duplicate[0].notes).toContain("a second observation");
  expect(settingsSchema.parse({...defaultSettings,targetId:"DS-16Cyg"}).targetId).toBe("DS-16Dra");
  expect(targets.find(t=>t.id==="NGC2169")!.category).toBe("Open Cluster");
  expect(targets.find(t=>t.id==="DS-OmCep")!.name).not.toContain("Kemble");
 });
 it("does not promise ordinary-binocular splits for tight doubles",async()=>{
  const catalog=await loadBinocularTargets();for(const id of ["DS-SigCas","DS-OmCep","DS-GamAri","DS-BetMon","DS-AlmaakDS"]){const t=catalog.find(t=>t.id===id)!;expect(t.sep).toBeLessThan(10);expect(t.binoTip).toContain("requires a telescope");}
 });
 it("never models a nova's historical outburst as a permanent bright anchor",async()=>{
  const star=(await loadStars()).find(s=>s.id==="HR5958")!;expect(star.mag).toBeGreaterThanOrEqual(9);expect(star.magnitudeNote).toContain("quiescent");
 });
 it("excludes daylight/near-Sun planetary guides and limits guided hops in generated routes",async()=>{
  const date=new Date("2026-10-13T22:53:00Z");expect(getPlanetPositions(lat,lon,date)).toEqual([]);
  const result=await planRoutes({lat,lon,date,targetId:"M13",fovWidth:7,fovHeight:7,fovShape:"circle",limitingMag:6.5,observingMode:"binocular",difficulty:"beginner",numRoutes:3});
  expect(result.routes.length).toBeGreaterThan(0);expect(result.nodes.some(n=>n.id==="HR5958"||n.type==="planet")).toBe(false);
  for(const route of result.routes)for(const hop of route.hops.slice(1))expect(hop.distanceDeg).toBeLessThanOrEqual(4.9+1e-6);
 });
 it("uses constellation genitives for stellar designations",()=>{expect(getConstellationGenitive("Lib")).toBe("Librae");expect(getConstellationGenitive("Ser")).toBe("Serpentis");expect(getConstellationGenitive("Her")).toBe("Herculis");});
 it("puts exact IDs before similarly named objects and accepts common catalog spelling",()=>{
  for(const query of ["M4","m 4","Messier 4","NGC 6121"]){const hits=targets.filter(t=>Number.isFinite(catalogSearchScore(t,query))).sort((a,b)=>catalogSearchScore(a,query)-catalogSearchScore(b,query));expect(hits[0].id).toBe("M4");}
  expect(catalogSearchScore(targets.find(t=>t.id==="M31")!," andromeda galaxy ")).toBeLessThan(Infinity);
  expect(targets.some(t=>Number.isFinite(catalogSearchScore(t,"xyzzy")))).toBe(false);
 });
 it("schedules the setting Lagoon before high targets regardless of insertion order",()=>{
  const at=new Date("2026-10-14T03:16:00Z");
  for(const ids of [["M39","M13","M8"],["M13","M8","M39"],["M8","M39","M13"]]){
    const s=makeSession("Setting first",at,lat,lon,ids.map(id=>({id,notes:"",addedAt:at.toISOString()})));
    const steps=suggestSequence(s,targets);expect(steps[0].id).toBe("M8");expect(steps.every(step=>step.date)).toBe(true);
  }
 });
 it("keeps future moonless boundaries stable as the live clock advances",()=>{
  const first=moonDay(lat,lon,new Date("2026-10-13T22:36:00Z"),zone),later=moonDay(lat,lon,new Date("2026-10-13T22:43:00Z"),zone);
  expect(first.windows.length).toBeGreaterThan(0);expect(Math.abs(first.windows[0].start.getTime()-later.windows[0].start.getTime())).toBeLessThan(45_000);expect(Math.abs(first.windows[0].end.getTime()-later.windows[0].end.getTime())).toBeLessThan(45_000);
  expect(moonState(lat,lon,first.windows[0].start).sunAlt).toBeLessThanOrEqual(-18);
  expect(Math.abs(first.windows[0].start.getTime()-first.set!.getTime())).toBeLessThan(1000);
 });
 it("calls daylight daylight rather than twilight",()=>{const advice=targetMoonlight(targets.find(t=>t.id==="M13")!,lat,lon,new Date("2026-10-13T22:31:00Z")).advice;expect(advice).toContain("Daylight");expect(advice).not.toContain("Twilight");});
 it("samples summer deep-sky planning after dusk while retaining the fixed-time reference",()=>{
  const dark=binocularSample(2026,6,lat,lon,zone,"dark"),fixed=binocularSample(2026,6,lat,lon,zone,"fixed");expect(moonState(lat,lon,dark).sunAlt).toBeLessThan(-18);expect(formatInTimeZone(fixed,zone,"HH:mm")).toBe("21:00");
  const polar=binocularSample(2026,6,89,0,"Etc/UTC","dark");expect(moonState(89,0,polar).sunAlt).toBeGreaterThan(-18);
 });
 it("supports tab bookmarks and target links without inventing unknown views",()=>{expect(pageForPath("/binoculars")).toBe("binocular");expect(pageForPath("/planner")).toBe("night");expect(pageForPath("/hop/M31")).toBe("hop");expect(targetFromPath(pathForPage("hop","M31"))).toBe("M31");expect(pageForPath("/unknown")).toBeNull();});
 it("aligns polygon projection with stars even in mirrored and rotated polar fields",()=>{
  for(const frame of [{ra:250,dec:36},{ra:359,dec:80}])for(const mirrored of [false,true])for(const rotation of [0,90,180,270]){
    const focus={ra:frame.ra+1,dec:frame.dec-1},point={ra:frame.ra+2,dec:frame.dec+1};const projection=skyPolygonProjection(frame,focus,10,mirrored,rotation);
    const expected=orientChartPoint(projectChartPoint(point,frame,focus,10)!,mirrored,rotation),actual=projection([point.ra,point.dec])!;expect(actual[0]).toBeCloseTo(300+expected.x,6);expect(actual[1]).toBeCloseTo(300+expected.y,6);
  }
 });
 it("retains polygon holes and keeps Milky Way fill out of the Hercules field",async()=>{
  const mw=await loadMilkyWay();expect(mw[0].coordinates[0].length).toBeGreaterThan(1);
  const her={ra:250.4,dec:36.46};expect(milkyWayPaths(mw,her,her,30)).toHaveLength(0);
  const cyg={ra:305,dec:40};expect(milkyWayPaths(mw,cyg,cyg,30).length).toBeGreaterThan(0);
 });
 it("rejects labels crossing the horizon circle and finds nearby stars across polar RA buckets",()=>{
  expect(labelFits({left:60,right:180,top:530,bottom:550},{left:0,right:600,top:0,bottom:600},{x:300,y:300,r:260})).toBe(false);
  expect(boxesOverlap({left:0,right:20,top:0,bottom:20},{left:15,right:30,top:15,bottom:30})).toBe(true);
  const start={id:"start",ra:0,dec:89,mag:2,name:"A",type:"star" as const,alt:40,az:0},goal={...start,id:"goal",ra:90,name:"B"};expect(variableReachAStar(start,goal,[start,goal],7,"beginner")).not.toBeNull();
 });
});
