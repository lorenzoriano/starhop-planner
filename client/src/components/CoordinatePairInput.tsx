import "./CoordinatePairInput.css";
import { useId,useState } from "react";
import { parseCoordinatePair } from "@/lib/saved-locations";

/** Paste a pair once; draft forms can populate their existing coordinate fields. */
export function CoordinatePairInput({onParsed,onUse}:{onParsed?:(lat:number,lon:number)=>void;onUse?:(lat:number,lon:number)=>void}) {
  const id=useId(),[value,setValue]=useState(''),[touched,setTouched]=useState(false);
  const parsed=parseCoordinatePair(value),invalid=touched&&!!value.trim()&&!parsed;
  const use=()=>{if(parsed)onUse?.(parsed.lat,parsed.lon);};
  return <div className="coordinate-pair-input">
    <label htmlFor={id}>Coordinates (latitude, longitude)</label>
    <div className="coordinate-pair-row"><input id={id} type="text" autoComplete="off" spellCheck={false} placeholder="37.72835, -119.61347" value={value} aria-invalid={invalid} aria-describedby={`${id}-help`} onBlur={()=>setTouched(true)} onChange={event=>{const next=event.target.value;setValue(next);setTouched(false);const coordinates=parseCoordinatePair(next);event.target.setCustomValidity(next.trim()&&!coordinates?'Enter valid latitude and longitude.':'');if(coordinates)onParsed?.(coordinates.lat,coordinates.lon);}} onKeyDown={event=>{if(event.key==='Enter'&&onUse){event.preventDefault();setTouched(true);use();}}}/>{onUse&&<button type="button" className="context-apply" disabled={!parsed} onClick={use}>Use coordinates</button>}</div>
    <p id={`${id}-help`} role="status">{parsed?`Latitude ${parsed.lat}° · Longitude ${parsed.lon}°`:invalid?'Enter latitude −90 to 90, then longitude −180 to 180.':'Paste decimal degrees separated by a comma or space. South and west are negative.'}</p>
  </div>;
}
