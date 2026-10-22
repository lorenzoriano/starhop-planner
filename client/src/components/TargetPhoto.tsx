import { useEffect, useState } from "react";
import type { UnifiedTarget } from "@/lib/astronomy";
import { primaryOpticalImage } from "@/lib/binocular-media";
import { PhotoFieldPreview, type PhotoOpticalField } from "./PhotoFieldPreview";

/** The same archival optical photograph across discovery cards and saved sessions. */
export function TargetPhoto({target,compact=false,opticalField}:{target:UnifiedTarget;compact?:boolean;opticalField?:PhotoOpticalField}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[target.id]);
  const photo=primaryOpticalImage(target.id);
  return <div className="target-photo">
    {photo&&!failed ? <img src={`./${photo.path}`} width={photo.width} height={photo.height} loading={compact?"lazy":"eager"} decoding="async" onError={()=>setFailed(true)} alt={`${photo.title} — ${target.name}. ${photo.note}`}/> : <span className="target-photo-unavailable">Archive photograph unavailable</span>}
    {opticalField&&<PhotoFieldPreview key={target.id} target={target} field={opticalField}/>}
    {photo&&!failed&&<span className="target-photo-caption" title={`${photo.credit} · ${photo.licenseName}`}>{photo.caption}</span>}
  </div>;
}

export function TargetPhotoCredit({target}:{target:UnifiedTarget}) {
  const photo=primaryOpticalImage(target.id);
  if(!photo)return null;
  return <div className="target-photo-credit"><p>{photo.note}</p><span>{photo.credit} · {photo.licenseName}</span><div><a href={photo.url} target="_blank" rel="noreferrer">Photograph source ↗</a><a href={photo.policy} target="_blank" rel="noreferrer">Credits & use ↗</a></div></div>;
}
