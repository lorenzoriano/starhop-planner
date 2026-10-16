import { describe,it,expect } from "vitest";
import { matchingLocation, savedLocationsSchema, saveObservingLocation } from "../saved-locations";
const garden={id:"garden",name:"Home garden",lat:51.5,lon:-.12};
describe("saved observing locations",()=>{
  it("validates persisted locations and rejects invalid coordinates/names",()=>{
    expect(savedLocationsSchema.parse([garden])).toEqual([garden]);
    for(const patch of [{name:" "},{lat:91},{lon:-181},{lat:NaN},{lon:Infinity}])expect(savedLocationsSchema.safeParse([{...garden,...patch}]).success).toBe(false);
  });
  it("updates names case-insensitively without duplicates or mutating previous records",()=>{
    const result=saveObservingLocation([garden]," home GARDEN ",-33.87,151.21);
    expect(result.ok).toBe(true);if(!result.ok)return;
    expect(result.locations).toEqual([{id:"garden",name:"home GARDEN",lat:-33.87,lon:151.21}]);
    expect(garden.lat).toBe(51.5);expect(matchingLocation(result.locations,-33.87000001,151.21)?.id).toBe("garden");expect(matchingLocation(result.locations,51.5,-.12)).toBeUndefined();
  });
  it("adds a distinct spot and preserves the source list",()=>{
    const result=saveObservingLocation([garden],"Campsite",0,0);expect(result.ok).toBe(true);if(!result.ok)return;
    expect(result.locations).toHaveLength(2);expect(result.locations[0]).toEqual(garden);expect(result.location.id).not.toBe(garden.id);
    expect(saveObservingLocation([],"Bad",NaN,0).ok).toBe(false);
  });
  it("limits new spots without blocking edits to existing names",()=>{
    const sites=Array.from({length:50},(_,i)=>({...garden,id:String(i),name:`Site ${i}`}));
    expect(saveObservingLocation(sites,"Another",0,0).ok).toBe(false);expect(saveObservingLocation(sites,"Site 0",0,0).ok).toBe(true);
  });
});
