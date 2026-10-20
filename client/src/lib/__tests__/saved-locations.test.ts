import { describe,it,expect } from "vitest";
import { matchingLocation, savedLocationsSchema, saveObservingLocation,parseCoordinatePair } from "../saved-locations";
const garden={id:"garden",name:"Home garden",lat:51.5,lon:-.12};
describe("saved observing locations",()=>{
  it("parses pasted decimal coordinates without rounding or swapping axes",()=>{
    for(const input of ['37.72835, -119.61347','  37.72835 -119.61347  ','+37.72835; −119.61347'])expect(parseCoordinatePair(input)).toEqual({lat:37.72835,lon:-119.61347});
    expect(parseCoordinatePair('-33.87, +151.21')).toEqual({lat:-33.87,lon:151.21});
    expect(parseCoordinatePair('0, 0')).toEqual({lat:0,lon:0});
    expect(parseCoordinatePair('-90, 180')).toEqual({lat:-90,lon:180});
  });
  it("rejects incomplete, ambiguous and out-of-range coordinate pairs",()=>{
    for(const input of ['', '37.72835,', '37.72835', '37,,119','37,119,2','-119.61347,37.72835','91,0','0,-181','NaN,0','Infinity,0','0x10,0','1e2,0','37 north,119 west'])expect(parseCoordinatePair(input),input).toBeNull();
  });
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
