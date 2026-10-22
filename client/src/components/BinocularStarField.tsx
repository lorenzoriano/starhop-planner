import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { angularDistance, loadDenseStars, loadStars, type DenseStar, type Star, type UnifiedTarget } from '@/lib/astronomy';
import { useFinderStars } from '@/hooks/use-finder-stars';
import { opticalFieldStars } from '@/lib/optical-star-field';
import { opticalOpening, photoTangentOffset } from '@/lib/photo-framing';
import { catalogExtent } from '@/lib/catalog-extents';
import { angularEllipse } from '@/lib/optical-geometry';
import type { EquatorialPoint } from '@/lib/chart-view';

export function BinocularStarField({target,center,width,height,shape,mirrored,rotation,initialDepth=8}:{target:UnifiedTarget;center:EquatorialPoint;width:number;height:number;shape:'circle'|'rectangle';mirrored:boolean;rotation:number;initialDepth?:number}) {
  const [base,setBase]=useState<DenseStar[]>([]),[named,setNamed]=useState<Star[]>([]),[state,setState]=useState<'loading'|'ready'|'error'>('loading');
  const [depth,setDepth]=useState(Math.max(5,Math.min(10.5,initialDepth))),[guides,setGuides]=useState(true),[names,setNames]=useState(true),[attempt,setAttempt]=useState(0);
  const [starScale,setStarScale]=useState(1);
  const detailed=useFinderStars(target.id,depth>8);
  const svgRef=useRef<SVGSVGElement>(null),[unit,setUnit]=useState(1);
  const id=`eyepiece-${useId().replaceAll(':','')}`;
  useEffect(()=>{let cancelled=false;setState('loading');Promise.all([loadDenseStars(),loadStars()]).then(([stars,labels])=>{if(!cancelled){setBase(stars);setNamed(labels.filter(s=>!!s.name));setState('ready');}}).catch(()=>{if(!cancelled)setState('error');});return()=>{cancelled=true;};},[attempt]);
  useLayoutEffect(()=>{const svg=svgRef.current;if(!svg)return;const update=()=>{const b=svg.getBoundingClientRect();if(b.width&&b.height)setUnit(600/Math.min(b.width,b.height));};update();const observer=new ResizeObserver(update);observer.observe(svg);return()=>observer.disconnect();},[]);
  const opening=opticalOpening(width,height,shape);
  const points=useMemo(()=>opticalFieldStars([...base,...detailed.stars.filter(s=>s[2]>8)],center,width,height,shape,depth,rotation,mirrored),[base,detailed.stars,center,width,height,shape,depth,rotation,mirrored]);
  const batches=useMemo(()=>{
    const result=new Map<string,{color:string;opacity:number;d:string}>();
    for(const p of points){const r=p.radius*unit*starScale,key=`${p.color}/${Math.round(p.opacity*10)/10}`,group=result.get(key)??{color:p.color,opacity:Math.round(p.opacity*10)/10,d:''};group.d+=`M${p.x-r},${p.y}a${r},${r} 0 1 0 ${2*r},0a${r},${r} 0 1 0 ${-2*r},0`;result.set(key,group);}
    return Array.from(result.values());
  },[points,unit,starScale]);
  const labels=useMemo(()=>{
    if(!names)return [];
    const used:Array<{x:number;y:number;width:number}>=[];
    return named.filter(s=>s.mag<=Math.min(depth,6)).sort((a,b)=>a.mag-b.mag).flatMap(s=>{
      const p=photoTangentOffset(s.ra,s.dec,center.ra,center.dec);if(!p)return [];
      const x=p.x*opening.scale,y=p.y*opening.scale,w=(s.name!.length*7+10)*unit;
      // Names reserve their complete boxes inside the circular opening.
      const left=x+7*unit,right=left+w,top=y-14*unit,bottom=y+2*unit;
      if(shape==='circle'?![[left,top],[right,top],[left,bottom],[right,bottom]].every(([a,b])=>a*a+b*b<(opening.width/2)**2):left<-opening.width/2||right>opening.width/2||top<-opening.height/2||bottom>opening.height/2)return [];
      if(used.some(b=>Math.abs(y-b.y)<18*unit&&left<b.x+b.width&&right>b.x))return [];
      used.push({x:left,y,width:w});return[{...s,x,y,labelX:left}];
    }).slice(0,14);
  },[names,named,depth,center,opening.scale,opening.width,opening.height,shape,unit]);
  const extent=catalogExtent(target),outline=extent?angularEllipse(target,extent.major,extent.positionAngle===null?extent.major:extent.minor,extent.positionAngle??0).flatMap(p=>{const v=photoTangentOffset(p.ra,p.dec,center.ra,center.dec);return v?[v]:[];}).map((p,i)=>`${i?'L':'M'}${p.x*opening.scale},${p.y*opening.scale}`).join(' ')+' Z':null;
  const targetOffset=photoTangentOffset(target.ra,target.dec,center.ra,center.dec);
  const deepRadius=angularDistance(target.ra,target.dec,center.ra,center.dec)+(shape==='circle'?width:Math.hypot(width,height))/2;
  return <section className="binocular-eyepiece" aria-label="Binocular identification star field">
    <svg ref={svgRef} className="photo-optics-field" viewBox="0 0 600 600" role="img" aria-label={`${target.name} catalog star field, ${width.toFixed(2)} degree ${shape==='circle'?'circular':'rectangular'} field, stars to magnitude ${depth}. Colors follow catalog B minus V and sizes follow brightness.`} data-binocular-star-field="true" data-field-width={width} data-limiting-mag={depth} data-field-star-count={points.length} data-star-scale={starScale}>
      <defs><clipPath id={id}>{shape==='circle'?<circle cx="300" cy="300" r={opening.width/2}/>:<rect x={300-opening.width/2} y={300-opening.height/2} width={opening.width} height={opening.height}/>}</clipPath></defs>
      <rect width="600" height="600" fill="#03070c"/>
      <g clipPath={`url(#${id})`}><rect x={300-opening.width/2} y={300-opening.height/2} width={opening.width} height={opening.height} fill="#070d18"/>
        <g transform={`translate(300 300) rotate(${rotation}) scale(${mirrored?-1:1} 1)`}>
          {points.filter(p=>p.mag<4).map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={p.radius*3*unit*starScale} fill={p.color} opacity=".08"/>)}
          {batches.map((batch,i)=><path key={i} data-star-batch="true" d={batch.d} fill={batch.color} opacity={batch.opacity}/>)}
          {guides&&outline&&<path data-eyepiece-object-extent="true" d={outline} fill="none" stroke="#9ab9b0" strokeWidth={unit} strokeDasharray={`${3*unit} ${4*unit}`} opacity=".65"/>}
          {guides&&targetOffset&&<g transform={`translate(${targetOffset.x*opening.scale} ${targetOffset.y*opening.scale})`}><circle r={7*unit} fill="none" stroke="#d2bf88" strokeWidth={unit}/><path d={`M${-12*unit},0h${4*unit}M${8*unit},0h${4*unit}M0,${-12*unit}v${4*unit}M0,${8*unit}v${4*unit}`} stroke="#d2bf88" strokeWidth={unit}/></g>}
          {labels.map(s=><g key={s.id} transform={`translate(${s.labelX} ${s.y-4*unit}) scale(${mirrored?-1:1} 1) rotate(${-rotation})`}><text data-eyepiece-star-name={s.id} fill="#b8c7d4" fontSize={12*unit} fontFamily="var(--font-sans)" paintOrder="stroke" stroke="#070d18" strokeWidth={3*unit}>{s.name}</text></g>)}
        </g>
      </g>
      {shape==='circle'?<circle cx="300" cy="300" r={opening.width/2} fill="none" stroke="#b5d7cd" strokeWidth="1.5"/>:<rect x={300-opening.width/2} y={300-opening.height/2} width={opening.width} height={opening.height} fill="none" stroke="#b5d7cd" strokeWidth="1.5"/>}
      <g fill="#acbec5" fontSize="24" textAnchor="middle"><text x="300" y="55">{width.toFixed(2)}° true field</text><text x="300" y="555">{mirrored?'Mirrored · ':''}{rotation?`Rotated ${rotation}°`:'North up · east left'}</text></g>
    </svg>
    <div className="eyepiece-star-controls"><label>Stars to magnitude <input aria-label="Binocular star field depth" type="range" min="5" max="10.5" step="0.5" value={depth} onChange={e=>setDepth(Number(e.target.value))}/><output>{depth.toFixed(1)}</output></label><label>Star size <input aria-label="Binocular star size" type="range" min="0.75" max="2" step="0.25" value={starScale} onChange={e=>setStarScale(Number(e.target.value))}/><output>{starScale.toFixed(2)}×</output></label><label><input type="checkbox" checked={names} onChange={e=>setNames(e.target.checked)}/>Star names</label><label><input type="checkbox" checked={guides} onChange={e=>setGuides(e.target.checked)}/>Object outline & marker</label></div>
    <p className="photo-optics-note" role="status">{state==='loading'?'Loading star catalog…':state==='error'?<>Star catalog unavailable. <button type="button" onClick={()=>setAttempt(n=>n+1)}>Retry</button></>:`${points.length.toLocaleString()} catalog stars in this field.`} {depth>8?(detailed.state==='loading'?'Loading deeper reference stars…':detailed.state==='ready'?`Tycho-2 reference to VT 10.5${deepRadius>8?' within 8° of the object; bright catalog outside':''}.`:'Detailed reference unavailable; showing the bright catalog to magnitude 8.'):'Bright-star catalog to magnitude 8.'}</p>
    <p className="photo-optics-note">Match the pattern of stars to your binocular view. Dot sizes show brightness; colors follow catalog B−V. Adjust Star size for readability without changing the field of view or which stars are included. The outline marks the object’s catalog size; nebulosity and photographic detail are not rendered. Increasing depth may show stars too faint for your optics or sky.</p>
  </section>;
}
