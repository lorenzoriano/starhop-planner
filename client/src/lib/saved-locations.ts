import { z } from "zod";

export const savedLocationSchema = z.object({
  id:z.string().min(1), name:z.string().trim().min(1).max(80),
  lat:z.number().finite().min(-90).max(90), lon:z.number().finite().min(-180).max(180),
});
export const savedLocationsSchema = z.array(savedLocationSchema).max(50);
export type SavedLocation = z.infer<typeof savedLocationSchema>;
/** Decimal degrees in latitude, longitude order; never guess or swap axes. */
export function parseCoordinatePair(input:string):{lat:number;lon:number}|null {
  const number='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const match=input.trim().replaceAll('−','-').match(new RegExp(`^(${number})(?:\\s*[,;]\\s*|\\s+)(${number})$`));
  if(!match)return null;
  const lat=Number(match[1]),lon=Number(match[2]);
  return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?{lat,lon}:null;
}
export function matchingLocation(locations:SavedLocation[],lat:number,lon:number) {
  return locations.find(site=>Math.abs(site.lat-lat)<1e-6&&Math.abs(site.lon-lon)<1e-6);
}
/** Saving the same name updates that spot, rather than creating duplicates. */
export function saveObservingLocation(locations:SavedLocation[],name:string,lat:number,lon:number) {
  const previous=locations.find(site=>site.name.toLocaleLowerCase()===name.trim().toLocaleLowerCase());
  const parsed=savedLocationSchema.safeParse({id:previous?.id??crypto.randomUUID(),name,lat,lon});
  if(!parsed.success)return {ok:false as const,error:"Enter a location name (up to 80 characters) and valid latitude and longitude."};
  if(!previous&&locations.length>=50)return {ok:false as const,error:"You have 50 saved locations. Remove a spot before adding another."};
  const location=parsed.data;
  return {ok:true as const,location,locations:previous?locations.map(site=>site.id===previous.id?location:site):[...locations,location]};
}

/** Known preset and saved-site names share one coordinate match rule. */
export function knownLocationName(locations:SavedLocation[],lat:number,lon:number) {
  return matchingLocation(locations,lat,lon)?.name??[
    {name:"San Francisco",lat:37.77,lon:-122.42},{name:"London",lat:51.5,lon:-.12},{name:"Sydney",lat:-33.87,lon:151.21},
  ].find(site=>Math.abs(site.lat-lat)<1e-6&&Math.abs(site.lon-lon)<1e-6)?.name;
}
