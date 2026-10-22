import type { DenseStar } from './astronomy';
import type { EquatorialPoint } from './chart-view';
import { opticalOpening, photoTangentOffset } from './photo-framing';
import { stellarColor, stellarRadius } from './stellar-appearance';

export interface FieldStar {ra:number;dec:number;mag:number;bv:number;x:number;y:number;color:string;radius:number;opacity:number;}

/** Real ICRS catalogue points in the same TAN plane as the photographic view.
 * Return only points within the optical opening; there is no decorative sky. */
export function opticalFieldStars(stars:readonly DenseStar[],center:EquatorialPoint,width:number,height:number,shape:'circle'|'rectangle',limitingMag:number,rotation=0,mirrored=false):FieldStar[] {
  const opening=opticalOpening(width,height,shape),result:FieldStar[]=[];
  const angle=rotation*Math.PI/180;
  for(const [ra,dec,mag,bv] of stars){
    if(mag>limitingMag)continue;
    // Cheap spherical-cap exclusion before projection (valid at RA wrap/poles).
    if(Math.abs(dec-center.dec)>Math.max(width,height))continue;
    const p=photoTangentOffset(ra,dec,center.ra,center.dec);if(!p)continue;
    const x=p.x*opening.scale,y=p.y*opening.scale;
    const mx=mirrored?-x:x,rx=mx*Math.cos(angle)-y*Math.sin(angle),ry=mx*Math.sin(angle)+y*Math.cos(angle);
    const inside=shape==='circle'?rx*rx+ry*ry<=(opening.width/2)**2:Math.abs(rx)<=opening.width/2&&Math.abs(ry)<=opening.height/2;
    if(!inside)continue;
    result.push({ra,dec,mag,bv,x,y,color:stellarColor(undefined,bv),radius:stellarRadius(mag)*1.5,opacity:Math.max(.4,Math.min(1,1-(mag-5)*.09))});
  }
  return result.sort((a,b)=>b.mag-a.mag);
}
