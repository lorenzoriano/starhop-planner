import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { altitudeExplanation, altitudeLabel } from '@/lib/observing';
import './ExplainedStatus.css';

/** The same explanation is available by pointer hover, keyboard focus and tap. */
export function ExplainedStatus({label,children,explanation,className=''}:{label:string;children?:ReactNode;explanation:ReactNode;className?:string}) {
  const [open,setOpen]=useState(false);
  const pinned=useRef(false),focused=useRef(false),timer=useRef<ReturnType<typeof setTimeout>>();
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const cancelClose=()=>clearTimeout(timer.current);
  const closeSoon=()=>{cancelClose();timer.current=setTimeout(()=>{if(!pinned.current&&!focused.current)setOpen(false);},150);};
  return <Popover open={open} onOpenChange={value=>{cancelClose();setOpen(value);if(!value)pinned.current=false;}}>
    <PopoverTrigger asChild><button type="button" className={`status-help-trigger ${className}`} aria-label={`Explain: ${label}`}
      onPointerEnter={event=>{if(event.pointerType==='mouse'){cancelClose();setOpen(true);}}} onPointerLeave={closeSoon}
      onFocus={()=>{focused.current=true;cancelClose();setOpen(true);}} onBlur={()=>{focused.current=false;closeSoon();}}
      onClick={event=>{event.preventDefault();cancelClose();pinned.current=!pinned.current;setOpen(pinned.current);}}>
      {children??label}<Info size={13} aria-hidden="true"/>
    </button></PopoverTrigger>
    <PopoverContent className="status-help-content" align="end" sideOffset={6} aria-label={`${label}: explanation`}
      onOpenAutoFocus={event=>event.preventDefault()} onCloseAutoFocus={event=>event.preventDefault()}
      onPointerEnter={cancelClose} onPointerLeave={closeSoon}>
      <strong>{label}</strong><div>{explanation}</div>
    </PopoverContent>
  </Popover>;
}

export function AltitudeStatus({alt,sunAlt}:{alt:number;sunAlt?:number}) {
  return <ExplainedStatus label={altitudeLabel(alt)} className={`visibility-tag ${alt<20?'low':''}`} explanation={<>
    <p>{altitudeExplanation(alt)}</p>
    {sunAlt!==undefined&&<p>{sunAlt>=0?`The Sun is ${sunAlt.toFixed(1)}° high at the chosen time: it is daylight. Preview astronomical darkness to plan this object.`:sunAlt>-18?`The Sun is ${Math.abs(sunAlt).toFixed(1)}° below the horizon: twilight can still hide faint detail.`:'The Sun is below −18° at the chosen time: astronomical darkness.'}</p>}
    <p>This label describes height above a flat horizon. Clouds, terrain, Moonlight and the object's brightness also affect the view.</p>
  </>}/>;
}
