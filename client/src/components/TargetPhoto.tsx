import { useEffect, useState } from "react";
import type { UnifiedTarget } from "@/lib/astronomy";
import { binocularMedia, SURVEY_CREDITS } from "@/lib/binocular-media";

/** The same archival optical photograph across discovery cards and saved sessions. */
export function TargetPhoto({target,compact=false}:{target:UnifiedTarget;compact?:boolean}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[target.id]);
  const media=binocularMedia(target.id);
  const photo=media?.images.find(image=>image.variant==="optical");
  return <div className="target-photo">
    {photo&&!failed ? <img src={`./${photo.path}`} width={640} height={480} loading={compact?"lazy":"eager"} decoding="async" onError={()=>setFailed(true)} alt={`DSS2 archival optical photograph of ${target.name}, ${media!.fov.toFixed(1)}° wide. Telescope survey exposure; binoculars reveal less detail and color.`}/> : <span className="target-photo-unavailable">Archive photograph unavailable</span>}
    {photo&&!failed&&<span className="target-photo-caption">DSS2 · OPTICAL PHOTOGRAPH</span>}
  </div>;
}

export function TargetPhotoCredit({target}:{target:UnifiedTarget}) {
  const media=binocularMedia(target.id),photo=media?.images.find(image=>image.variant==="optical");
  if(!photo)return null;
  return <div className="target-photo-credit"><p>Telescope survey exposure · {media!.fov.toFixed(1)}° field. Binoculars reveal less detail and color.</p><span>{SURVEY_CREDITS.optical.credit}</span><div><a href={photo.url} target="_blank" rel="noreferrer">Original photograph ↗</a><a href={SURVEY_CREDITS.optical.policy} target="_blank" rel="noreferrer">Credits & use ↗</a></div></div>;
}
