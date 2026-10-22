import { useId, useState } from 'react';
import type { UnifiedTarget } from '@/lib/astronomy';
import { catalogExtent } from '@/lib/catalog-extents';
import { calibratedOpticalPhoto, photoFrameGeometry, photoTangentOffset } from '@/lib/photo-framing';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import './PhotoFieldPreview.css';

export interface PhotoOpticalField {width:number;height:number;shape:'circle'|'rectangle';label?:string;onChange?:(width:number)=>void;}

/** Compare angular framing, using only a survey with an explicit angular scale. */
export function PhotoFieldPreview({target,field,inline=false}:{target:UnifiedTarget;field:PhotoOpticalField;inline?:boolean}) {
  const [open,setOpen]=useState(false),[width,setWidth]=useState(String(Math.max(.2,Math.min(15,field.width)))),[mirrored,setMirrored]=useState(false),[rotation,setRotation]=useState(0),[failed,setFailed]=useState(false);
  const clipId=`photo-optics-${useId().replaceAll(':','')}`,photo=calibratedOpticalPhoto(target.id);
  const value=Number(width),valid=width.trim()!==''&&Number.isFinite(value)&&value>=.2&&value<=15;
  const fieldWidth=valid?value:Math.max(.2,Math.min(15,field.width));
  const fieldHeight=field.shape==='circle'?fieldWidth:field.height;
  const geometry=photo?photoFrameGeometry(photo,fieldWidth,fieldHeight,field.shape):null;
  const coverageComplete=!!geometry&&(rotation%180===0?geometry.coverageComplete:geometry.imageHeight>=geometry.width&&geometry.imageWidth>=geometry.height);
  const extent=catalogExtent(target);
  const targetOffset=photo?photoTangentOffset(target.ra,target.dec,photo.ra,photo.dec):null;
  const restore=()=>{setWidth(String(Math.max(.2,Math.min(15,field.width))));setMirrored(false);setRotation(0);};
  const opening=geometry&&(field.shape==='circle'?<circle cx="300" cy="300" r={geometry.width/2}/>:<rect x={300-geometry.width/2} y={300-geometry.height/2} width={geometry.width} height={geometry.height}/>);
  return <>
    <button type="button" className={`target-photo-framing-toggle${inline?' photo-optics-inline':''}`} onClick={()=>{restore();setFailed(false);setOpen(true);}}>Preview optics</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="photo-optics-dialog">
        <DialogHeader><DialogTitle>{target.name} · optical framing</DialogTitle><DialogDescription>Compare the object with your field of view.</DialogDescription></DialogHeader>
        <p className="photo-optics-selected">{field.label??'Selected optics'} · {field.width.toFixed(2)}°{field.shape==='rectangle'?` × ${field.height.toFixed(2)}°`:''} field</p>
        {photo&&geometry&&!failed?<>
          <svg className="photo-optics-field" viewBox="0 0 600 600" role="img" aria-label={`${target.name} survey photograph in a ${fieldWidth.toFixed(2)} degree ${field.shape==='circle'?'circular':'rectangular'} field. ${coverageComplete?'The survey covers the opening.':'The hatched area is outside the available photograph.'}`} data-photo-field-width={fieldWidth} data-photo-field-height={fieldHeight}>
            <defs><clipPath id={clipId}>{opening}</clipPath><pattern id={`${clipId}-missing`} patternUnits="userSpaceOnUse" width="12" height="12"><rect width="12" height="12" fill="#12202a"/><path d="M-3 3L3-3M0 12L12 0M9 15L15 9" stroke="#314550" strokeWidth="1"/></pattern></defs>
            <rect width="600" height="600" fill="#03070c"/>
            <g clipPath={`url(#${clipId})`}>
              <rect width="600" height="600" fill={`url(#${clipId}-missing)`}/>
              <g transform={`translate(300 300) rotate(${rotation}) scale(${mirrored?-1:1} 1)`}>
                <image data-calibrated-photo="true" href={`./${photo.path}`} x={geometry.imageX} y={geometry.imageY} width={geometry.imageWidth} height={geometry.imageHeight} preserveAspectRatio="xMidYMid meet" onError={()=>setFailed(true)}/>
                {targetOffset&&<g data-photo-target-center="true" transform={`translate(${targetOffset.x*geometry.scale} ${targetOffset.y*geometry.scale})`}><circle r="6" fill="none" stroke="#b5d7cd" strokeWidth="1"/><path d="M-11 0H-8M8 0H11M0-11V-8M0 8V11" stroke="#b5d7cd" strokeWidth="1"/></g>}
              </g>
            </g>
            <g fill="none" stroke="#b5d7cd" strokeWidth="1.5">{opening}</g>
            <g fill="#acbec5" fontSize="24" textAnchor="middle"><text x="300" y="55">{fieldWidth.toFixed(2)}°{field.shape==='rectangle'?` × ${fieldHeight.toFixed(2)}°`:''} true field</text><text x="300" y="555">{mirrored?'Mirrored · ':''}{rotation?`Rotated ${rotation}°`:'North up · east left'}</text></g>
          </svg>
          {!coverageComplete&&<p className="photo-optics-coverage" role="status">Hatched area: no photograph in this part of the field. The available survey covers {photo.fieldWidth.toFixed(2)}° × {photo.fieldHeight.toFixed(2)}°.</p>}
        </>:<p className="photo-optics-unavailable">{failed?'The calibrated survey photograph could not be loaded.':'This object has no available photograph with a known angular scale.'} Its photographic framing cannot be simulated accurately.</p>}
        {extent&&<p className="photo-optics-selected">Catalog extent ≈ {extent.major.toFixed(2)}°{extent.minorKnown?` × ${extent.minor.toFixed(2)}°`:" across"} · {(extent.major/fieldWidth*100).toFixed(0)}% of this field’s width. Faint outer detail depends on sky conditions.</p>}
        <div className="photo-optics-controls">
          <label>Preview field width<input aria-label="Photo preview field width" type="number" min="0.2" max="15" step="0.05" value={width} onChange={event=>setWidth(event.target.value)}/><span>degrees</span></label>
          <div className="photo-optics-presets"><button type="button" onClick={restore}>Selected optics</button>{extent&&field.shape==='circle'&&<button type="button" onClick={()=>setWidth(String(Math.max(.2,Math.min(15,extent.major*1.2))))}>Frame object</button>}{[7,3.7,1,.5].map(degrees=><button key={degrees} type="button" onClick={()=>setWidth(String(degrees))}>{degrees}°</button>)}</div>
          {!valid&&<p role="alert">Enter a field width from 0.2° to 15°.</p>}
          <div className="photo-optics-orientation"><button type="button" aria-pressed={mirrored} onClick={()=>setMirrored(!mirrored)}>Mirror</button><button type="button" onClick={()=>setRotation((rotation+90)%360)}>Rotate · {rotation}°</button>{field.onChange&&<button type="button" disabled={!valid} onClick={()=>field.onChange?.(fieldWidth)}>Use this field in planetarium</button>}</div>
        </div>
        <p className="photo-optics-note">This preview shows angular framing. The long-exposure photograph records fainter detail and stronger color than the eye sees; changing field width does not predict brightness or resolution.</p>
        {photo&&<p className="photo-optics-note">DSS2 / CDS · TAN projection centered at RA {photo.ra.toFixed(4)}°, Dec {photo.dec.toFixed(4)}°. The small cross marks the catalog position. <a href="https://archive.stsci.edu/publishing/data-use" target="_blank" rel="noreferrer">Survey credits ↗</a></p>}
      </DialogContent>
    </Dialog>
  </>;
}
