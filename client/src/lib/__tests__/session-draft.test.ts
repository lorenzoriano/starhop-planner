import { describe,it,expect } from "vitest";
import { sessionDraft,resolveSessionDraft,reuseNightItems } from "../session-draft";
import type { ObservingSession } from "../session-planner";
const source:ObservingSession={id:"existing",name:"Autumn night",startAt:"2026-10-15T03:30:00.000Z",lat:37.77,lon:-122.42,locationName:"Garden",durationMinutes:61,minutesPerTarget:15,items:[{id:"M31",addedAt:"2026-10-10T01:00:00.000Z",notes:"Keep my sketch",observedAt:"2026-10-11T02:00:00.000Z"}],archived:false,createdAt:"2026-10-10T00:00:00.000Z"};
describe("inline session composition",()=>{
  it("roundtrips local date/site metadata without changing records or arbitrary valid durations",()=>{
    const draft=sessionDraft(source);expect(draft.date).toBe("2026-10-14");expect(draft.time).toBe("20:30");
    const result=resolveSessionDraft(draft,source);expect(result.ok).toBe(true);if(result.ok)expect({...source,...result.value}).toEqual(source);
  });
  it("resolves a changed site's civil time and rejects invalid changes",()=>{
    const draft={...sessionDraft(source),lat:"51.5",lon:"-.12",place:"London"};const result=resolveSessionDraft(draft,source);
    expect(result.ok).toBe(true);if(result.ok)expect(result.value.startAt).toBe("2026-10-14T19:30:00.000Z");
    for(const patch of [{lat:""},{lat:"99"},{duration:"12"},{perTarget:"0"},{name:""},{date:""},{time:"25:00"}])expect(resolveSessionDraft({...draft,...patch}).ok).toBe(false);
  });
  it("rejects the skipped DST hour and preserves a selected repeated-hour instant",()=>{
    expect(resolveSessionDraft({...sessionDraft(source),date:"2026-03-08",time:"02:30"}).ok).toBe(false);
    const repeated={...source,startAt:"2026-11-01T09:30:00.000Z"};const result=resolveSessionDraft(sessionDraft(repeated),repeated);expect(result.ok).toBe(true);if(result.ok)expect(result.value.startAt).toBe(repeated.startAt);
  });
  it("migrates unscheduled notes intact while reusing a saved night's targets starts fresh",()=>{
    const migrated=reuseNightItems(source.items,true);expect(migrated).toEqual(source.items);expect(migrated[0]).not.toBe(source.items[0]);
    const fresh=reuseNightItems(source.items,false,new Date("2026-10-15T00:00:00Z"));expect(fresh).toEqual([{id:"M31",addedAt:"2026-10-15T00:00:00.000Z",notes:""}]);expect(source.items[0].notes).toBe("Keep my sketch");expect(source.items[0].observedAt).toBeDefined();
  });
});
