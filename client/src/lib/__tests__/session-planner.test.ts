import { describe,it,expect } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { eveningOn,planningShortcut,makeSession,plannerStoreSchema,suggestSequence,sessionTimezone,starPlanningTarget } from "../session-planner";
import { skyConditions } from "../observing";
import { moonState,lunarFeatures } from "../moon";
import { angularDistance,eqToHorizontal,type UnifiedTarget } from "../astronomy";
const targets:UnifiedTarget[]=[{id:"M31",name:"Andromeda",displayName:"M31 Andromeda",ra:10.68,dec:41.27,con:"And",mag:3.4,category:"Spiral Galaxy",categoryShort:"Galaxy",source:"messier"},{id:"M13",name:"Hercules",displayName:"M13",ra:250.42,dec:36.46,con:"Her",mag:5.8,category:"Globular Cluster",categoryShort:"Glob Cl",source:"messier"},{id:"DS-Albireo",name:"Albireo",displayName:"Albireo",ra:292.68,dec:27.96,con:"Cyg",mag:3.1,category:"Double Star",categoryShort:"Dbl Star",source:"binocular"}];
const at=new Date("2026-10-19T04:00:00Z");
const item=(id:string)=>({id,addedAt:at.toISOString(),notes:""});
describe("observing session planner",()=>{
 it("chooses an actual dark evening for a daytime tonight preview",()=>{
  const now=new Date("2026-10-13T19:00:00Z"),choice=planningShortcut("tonight",37.77,-122.42,now);
  expect(choice.date>now).toBe(true);expect(formatInTimeZone(choice.date,"America/Los_Angeles","yyyy-MM-dd")).toBe("2026-10-13");expect(skyConditions(37.77,-122.42,choice.date).sunAlt).toBeLessThan(-18);
 });
 it("finds the next new Moon night offline and uses its site's date",()=>{
  const now=new Date("2026-10-13T19:00:00Z"),choice=planningShortcut("new-moon",-33.87,151.21,now);
  expect(choice.phaseAt!>now).toBe(true);expect(choice.date>now).toBe(true);expect(moonState(-33.87,151.21,choice.date).illumination).toBeLessThan(.015);expect(formatInTimeZone(choice.date,"Australia/Sydney","yyyy-MM-dd")).toBe(formatInTimeZone(choice.phaseAt!,"Australia/Sydney","yyyy-MM-dd"));
 });
 it("handles a polar date with no astronomical night honestly",()=>{const choice=eveningOn("2026-06-21",89,0);expect(choice.astronomicalDarkness).toBe(false);expect(choice.date.getTime()).toBeGreaterThan(0);});
 it("persists distinct sessions and keeps observation notes isolated",()=>{
  const first=makeSession("Back garden",at,37.77,-122.42,[{...item("M31"),notes:"faint oval",observedAt:at.toISOString()}]);const second=makeSession("Campsite",new Date("2026-11-09T09:00:00Z"),-33.87,151.21,[]);
  const store=plannerStoreSchema.parse({sessions:[first,second],activeId:first.id});expect(first.id).not.toBe(second.id);expect(store.sessions[0].items[0].notes).toBe("faint oval");expect(store.sessions[1].items).toHaveLength(0);expect(sessionTimezone(second)).toBe("Australia/Sydney");expect(plannerStoreSchema.safeParse({...store,sessions:[{...first,lat:100}]}).success).toBe(false);
 });
 it("suggests nonoverlapping slots and includes altitude and Moon separation",()=>{
  const session=makeSession("October",at,37.77,-122.42,targets.map(t=>item(t.id)));session.durationMinutes=240;
  const result=suggestSequence(session,targets);expect(result.filter(s=>s.date).length).toBeGreaterThan(0);expect(new Set(result.map(s=>s.id)).size).toBe(result.length);
  const scheduled=result.filter(s=>s.date);for(let i=0;i<scheduled.length;i++){const s=scheduled[i];expect(s.alt).toBeGreaterThanOrEqual(15);expect(s.date!>=at).toBe(true);expect(s.date!.getTime()+session.minutesPerTarget*60000).toBeLessThanOrEqual(at.getTime()+session.durationMinutes*60000);expect(s.separation!).toBeGreaterThanOrEqual(0);expect(s.separation!).toBeLessThanOrEqual(180);if(i)expect(s.date!.getTime()-scheduled[i-1].date!.getTime()).toBeGreaterThanOrEqual(session.minutesPerTarget*60000);const t=targets.find(t=>t.id===s.id)!;expect(eqToHorizontal(t.ra,t.dec,session.lat,session.lon,new Date(s.date!.getTime()+session.minutesPerTarget*60000)).alt).toBeGreaterThanOrEqual(15);}
 });
 it("does not schedule an object that cannot rise to a useful height",()=>{const session=makeSession("South",at,-33.87,151.21,[item("M31")]);const result=suggestSequence(session,targets);expect(result[0].date).toBeNull();expect(result[0].reason).toContain("No usable slot");});
 it("does not fabricate daytime deep-sky slots or reschedule completed targets",()=>{const session=makeSession("Day",new Date("2026-10-18T19:00:00Z"),37.77,-122.42,[item("M31"),{...item("M13"),observedAt:at.toISOString()}]);session.durationMinutes=60;const result=suggestSequence(session,targets);expect(result.some(s=>s.id==="M13")).toBe(false);expect(result[0].date).toBeNull();});
 it("uses real star catalog coordinates and allows them in the sequence",()=>{const target=starPlanningTarget({id:"HR7001",name:"Vega",ra:279.235,dec:38.784,mag:.03,constellation:"Lyr"});expect(target.id).toBe("star:HR7001");expect(target.ra).toBe(279.235);const session=makeSession("Stars",at,37.77,-122.42,[item(target.id)]);expect(suggestSequence(session,[target])[0].date).not.toBeNull();});
 it("distinguishes angular separation from altitude differences",()=>{const moon=moonState(37.77,-122.42,at);const near=angularDistance(moon.ra,moon.dec,moon.ra,moon.dec);const far=angularDistance(moon.ra,moon.dec,(moon.ra+180)%360,-moon.dec);expect(near).toBeCloseTo(0,5);expect(far).toBeCloseTo(180,5);const m31=targets[0];const distance=angularDistance(m31.ra,m31.dec,moon.ra,moon.dec);const altitudeDifference=Math.abs(eqToHorizontal(m31.ra,m31.dec,37.77,-122.42,at).alt-moon.alt);expect(Math.abs(distance-altitudeDifference)).toBeGreaterThan(10);});
 it("does not recommend a night-side lunar feature as visible",()=>{const feature=lunarFeatures.find(f=>f.name==="Grimaldi")!;const session=makeSession("Thin Moon",new Date("2026-10-15T03:00:00Z"),37.77,-122.42,[item(`moon:${feature.id}`)]);session.durationMinutes=60;expect(suggestSequence(session,targets)[0].date).toBeNull();});
});
