import { describe, expect, it, vi, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildUnifiedTargets, loadStars, loadMessier, loadBinocularTargets, type UnifiedTarget } from "../astronomy";
import { buildSkySafariExport, skyListText, skySafariIdentity, skySafariValue, type ExportContext } from "../skysafari-export";
import { starPlanningTarget, type ObservingSession } from "../session-planner";
import { canShareFile, shareFile } from "../file-transfer";

vi.stubGlobal("fetch",async(input:string)=>new Response(readFileSync(resolve(__dirname,"../../../public",input.replace(/^\.\//,"")),"utf8")));
afterAll(()=>vi.unstubAllGlobals());
const at = new Date("2026-10-15T03:30:00Z");
const item = (id:string,notes="",observedAt?:string) => ({id,notes,addedAt:at.toISOString(),observedAt});
const fixture:UnifiedTarget = {id:"M31",name:"Andromeda Galaxy",displayName:"M31 — Andromeda Galaxy",aliases:["NGC224"],category:"Galaxy",categoryShort:"Galaxy",source:"messier",ra:10.675,dec:41.267,mag:3.4,con:"And"};
const session = (items:ReturnType<typeof item>[]):ObservingSession => ({id:"night",name:"Autumn / clear night",lat:37.77,lon:-122.42,locationName:"Back garden",startAt:at.toISOString(),durationMinutes:180,minutesPerTarget:15,items,archived:false,createdAt:at.toISOString()});
const context:ExportContext = {items:[item("M31")],targets:[fixture],session:session([item("M31")]),date:new Date("2030-01-01Z"),lat:-33.87,lon:151.21,scope:"list",skyBrightness:21.6};

/** Independent shape check for the documented V3 grammar, not the serializer. */
function parseList(text:string) {
  const lines=text.trimEnd().split("\n");
  expect(lines.shift()).toBe("SkySafariObservingListVersion=3.0");
  const objects:Record<string,string[]>[]=[];
  while(lines.length) {
    expect(lines.shift()).toBe("SkyObject=BeginObject");const object:Record<string,string[]>={};
    while(lines[0]!=="EndObject=SkyObject") {
      const line=lines.shift();expect(line).toBeDefined();if(!line)throw new Error("Unclosed object");
      const eq=line.indexOf("=");expect(eq).toBeGreaterThan(0);const key=line.slice(0,eq);
      expect(["ObjectID","CatalogNumber","CommonName","Comment","DateObserved"]).toContain(key);
      (object[key]??=[]).push(line.slice(eq+1));
    }
    lines.shift();expect(object.ObjectID).toHaveLength(1);expect((object.CatalogNumber??object.CommonName)).toHaveLength(1);objects.push(object);
  }
  return objects;
}
describe("SkySafari interoperability",()=>{
  it("uses real catalog identifiers and the documented object types",async()=>{
    const targets=buildUnifiedTargets(await loadMessier(),await loadBinocularTargets());
    const examples:Record<string,[number,string]>={M31:[4,"M 31"],NGC869:[4,"NGC 869"],IC4665:[4,"IC 4665"],"DS-Albireo":[2,"Beta Cyg"],"DS-61Cyg":[2,"61 Cyg"],"STAR-Rasalgethi":[2,"Alpha1 Her"],"AST-Coathanger":[4,"Cr 399"],"AST-Hyades":[4,"Mel 25"],"DS-Winnecke4":[4,"M 40"]};
    for(const[id,[kind,catalog]]of Object.entries(examples))expect(skySafariIdentity(targets.find(t=>t.id===id)!)).toEqual({kind,catalog});
    expect(skySafariIdentity(starPlanningTarget((await loadStars()).find(s=>s.id==="HR424")!))).toEqual({kind:2,catalog:"HR 424"});
  });
  it("supplies one identifier and avoids matching against app nicknames",()=>{
    const exported=buildSkySafariExport(context);const object=parseList(exported.skylist)[0];
    expect(object.CatalogNumber).toEqual(["M 31"]);expect(object.CommonName).toBeUndefined();expect(exported.skylist).not.toContain("CatalogNumber=NGC 224");
    expect(object.Comment[0]).toContain("Andromeda Galaxy");expect(object.DateObserved).toBeUndefined();
  });
  it("writes actual observations as Julian dates, with safe multiline Unicode notes",()=>{
    const notes="Faint oval · μ And\nSkyObject=BeginObject\r\nComment=injection\nPath C:\\notes";
    const observedAt="2000-01-01T12:00:00.000Z";
    const exported=buildSkySafariExport({...context,items:[item("M31",notes,observedAt)]});
    const objects=parseList(exported.skylist);expect(objects).toHaveLength(1);expect(Number(objects[0].DateObserved[0])).toBe(2451545);
    expect(objects[0].Comment[0]).toContain("μ And\\nSkyObject=BeginObject\\nComment=injection");
    expect(objects[0].Comment[0]).toContain("C:\\\\notes");expect(exported.planText).toContain(notes);
    expect(skySafariValue("a\u0000b\u2028c")).toBe("ab\\nc");
  });
  it("keeps the session's date/site when the current preview differs",()=>{
    const exported=buildSkySafariExport(context);
    expect(exported.zone).toBe("America/Los_Angeles");expect(exported.planText).toContain("2026-10-14 20:30 -07:00");expect(exported.planText).toContain("Back garden · 37.7700°, -122.4200°");
    expect(exported.basename).toContain("2026-10-14");expect(exported.basename).not.toContain("/");expect(exported.planText).not.toContain("2030");
  });
  it("retains unsupported patterns and unknown records in complete notes, not fake sky IDs",()=>{
    const pattern={...fixture,id:"AST-JobsCoffin",name:"Job's Coffin",displayName:"Job's Coffin",category:"Asterism",aliases:[]};
    const exported=buildSkySafariExport({...context,items:[item(pattern.id,"Check four stars"),item("unknown-record","retain this")],targets:[pattern]});
    expect(exported.entries).toHaveLength(0);expect(exported.notesOnly).toHaveLength(2);expect(exported.planText).toContain("Check four stars");expect(exported.planText).toContain("retain this");expect(exported.planText).toContain("RA 10.67500°");expect(exported.skylist).not.toContain("AST-");
  });
  it("groups lunar landmarks under Moon without fabricating an aggregate observation",()=>{
    const exported=buildSkySafariExport({...context,items:[item("moon:3671","Oval sea",at.toISOString()),item("moon:3683","Keep this second lunar note")]});
    // Mare Crisium and Mare Nectaris use the actual bundled IAU IDs.
    expect(exported.lunarCount).toBe(2);const objects=parseList(exported.skylist);expect(objects).toHaveLength(1);expect(objects[0].CommonName).toEqual(["Moon"]);expect(objects[0].ObjectID).toEqual(["1,-1,-1"]);expect(objects[0].DateObserved).toBeUndefined();expect(objects[0].Comment[0]).toContain("Oval sea");expect(objects[0].Comment[0]).toContain("second lunar note");
  });
  it("exports the suggested night order, never marks planned times as observations",async()=>{
    const targets=buildUnifiedTargets(await loadMessier(),await loadBinocularTargets());
    const items=[item("M31"),item("M39"),item("M7"),item("M13","already seen",at.toISOString())];
    const exported=buildSkySafariExport({...context,session:session(items),items,targets,scope:"plan"});
    expect(exported.entries.length).toBeGreaterThan(0);expect(exported.entries.some(entry=>entry.itemIds.includes("M13"))).toBe(false);
    expect(exported.omittedFromPlan.some(item=>item.id==="M13"&&item.reason==="Already observed")).toBe(true);
    expect(exported.omittedFromPlan.some(item=>item.id==="M7")).toBe(true);
    const objects=parseList(exported.skylist);expect(objects.every(object=>!object.DateObserved)).toBe(true);expect(objects.every(object=>object.Comment[0].includes("Suggested start:"))).toBe(true);
    expect(exported.planText).toContain("already seen");expect(exported.planText).toContain("Not scheduled:");
  });
  it("coalesces catalog aliases without dropping either saved record's notes",()=>{
    const duplicate={...fixture,id:"alias-m31",aliases:["M31"]};
    const exported=buildSkySafariExport({...context,items:[item("M31","first note"),item("alias-m31","second note")],targets:[fixture,duplicate]});
    expect(parseList(exported.skylist)).toHaveLength(1);expect(exported.entries[0].itemIds).toEqual(["M31","alias-m31"]);expect(exported.skylist).toContain("first note");expect(exported.skylist).toContain("second note");
  });
  it("supports empty lists and omits invalid timestamps instead of inventing dates",()=>{
    expect(skyListText([])).toBe("SkySafariObservingListVersion=3.0\n");
    const text=skyListText([{kind:4,catalog:"M 31",name:"M31",itemIds:["M31"],comments:[],observedAt:"not-a-date"}]);expect(parseList(text)[0].DateObserved).toBeUndefined();
  });
});
describe("phone file transfer",()=>{
  it("uses the actual file capability, and distinguishes cancellation from handoff",async()=>{
    const file=new File(["test"],"night.skylist",{type:"text/plain"});
    const nativeShare=vi.fn().mockResolvedValue(undefined),canShare=vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator",{share:nativeShare,canShare});
    expect(canShareFile(file)).toBe(true);expect(await shareFile(file)).toBe("shared");expect(nativeShare).toHaveBeenCalledWith({files:[file]});
    nativeShare.mockRejectedValueOnce(new DOMException("Cancelled","AbortError"));expect(await shareFile(file)).toBe("cancelled");
    nativeShare.mockRejectedValueOnce(new Error("Unsupported target"));expect(await shareFile(file)).toBe("unavailable");
    canShare.mockReturnValue(false);expect(await shareFile(file)).toBe("unavailable");expect(nativeShare).toHaveBeenCalledTimes(3);
  });
});
