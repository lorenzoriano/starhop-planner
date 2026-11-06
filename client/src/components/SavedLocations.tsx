import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { Bookmark, X } from "lucide-react";
import { matchingLocation, saveObservingLocation, type SavedLocation } from "@/lib/saved-locations";
import { useLocalHorizonPreference } from "@/hooks/use-local-horizon";
import { storedHorizonKindsNear, storedHorizonSites } from "@/lib/horizon/store";
import { subscribeTerrainJobs, terrainStoreVersion } from "@/lib/horizon/terrain-jobs";

/** Ids of the saved locations with a terrain horizon stored nearby (works offline there). */
function useLocationsWithHorizon(locations:SavedLocation[]):Set<string> {
  const storeVersion=useSyncExternalStore(subscribeTerrainJobs,terrainStoreVersion,terrainStoreVersion),[enabled]=useLocalHorizonPreference();
  return useMemo(()=>{
    if(!enabled||!locations.length)return new Set<string>();
    const sites=storedHorizonSites();
    return new Set(locations.filter(site=>storedHorizonKindsNear(sites,site.lat,site.lon).includes("terrain")).map(site=>site.id));
    // storeVersion: re-read storage when a horizon was saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[locations,storeVersion,enabled]);
}

interface Props {
  locations:SavedLocation[]; lat:number; lon:number; name?:string; context:"Sky"|"Session";
  onChange:(locations:SavedLocation[])=>void; onSelect:(location:SavedLocation)=>void;
}
export function SavedLocations({locations,lat,lon,name,context,onChange,onSelect}:Props) {
  const [editing,setEditing]=useState(false),[label,setLabel]=useState(""),[message,setMessage]=useState("");
  const fieldId=useId(),current=matchingLocation(locations,lat,lon),withHorizon=useLocationsWithHorizon(locations);
  const save=()=>{
    const result=saveObservingLocation(locations,label,lat,lon);
    if(!result.ok){setMessage(result.error);return;}
    onChange(result.locations);onSelect(result.location);setEditing(false);setMessage(`Saved ${result.location.name} on this device.`);
  };
  return <div className="saved-locations" aria-label={`${context} saved locations`}>
    <div className="saved-location-picker">
      {locations.length>0&&<select aria-label={`${context} saved location`} value={current?.id??""} onChange={event=>{const site=locations.find(site=>site.id===event.target.value);if(site){onSelect(site);setEditing(false);setMessage("");}}}>
        <option value="" disabled>Choose a saved location</option>{locations.map(site=><option key={site.id} value={site.id}>{withHorizon.has(site.id)?`${site.name} · horizon saved`:site.name}</option>)}
      </select>}
      <button type="button" className="text-action" onClick={()=>{setLabel(current?.name??name??"");setMessage("");setEditing(!editing);}} aria-expanded={editing}><Bookmark size={13}/>{current?"Manage location":"Save location"}</button>
    </div>
    {editing&&<div className="saved-location-editor">
      <label htmlFor={fieldId}>Location name</label><input id={fieldId} aria-label={`${context} location name`} maxLength={80} value={label} placeholder="Home, dark-sky campsite…" onChange={event=>{setLabel(event.target.value);setMessage("");}} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();save();}}}/>
      <p>{Number.isFinite(lat)&&Number.isFinite(lon)?`${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : "Enter valid coordinates first."} · stored on this device, available offline.</p>
      <div><button type="button" className="text-action" onClick={save}>Save location</button>{current&&<button type="button" className="text-action" onClick={()=>{onChange(locations.filter(site=>site.id!==current.id));setEditing(false);setMessage(`Removed ${current.name} from saved locations. Existing nights keep their site.`);}}>Remove saved location</button>}<button type="button" className="icon-button" aria-label="Cancel saving location" onClick={()=>{setEditing(false);setMessage("");}}><X size={13}/></button></div>
    </div>}
    {message&&<p className="saved-location-status" role="status">{message}</p>}
  </div>;
}
