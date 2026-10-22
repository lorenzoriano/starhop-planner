import { geoContains,geoPath, geoStereographic } from "d3-geo";
import type { EquatorialPoint } from "./chart-view";
import { stereographicProject, type MilkyWayFeature } from "./astronomy";
import { orientChartPoint } from "./observing";
type Polygon={type:"Polygon";coordinates:number[][][]};
const prepared=new WeakMap<MilkyWayFeature,{rings:Polygon[];invert:boolean}>();
function prepare(feature:MilkyWayFeature){
  let value=prepared.get(feature);if(value)return value;
  const coordinates=feature.coordinates.map(polygon=>polygon.map(ring=>ring.map(([ra,dec])=>[ra>180?ra-360:ra,dec])));
  const rings:Polygon[]=coordinates.flatMap(polygon=>polygon.map(ring=>({type:"Polygon",coordinates:[ring]})));
  // Spherical winding can add a whole-sphere complement. Align ring parity
  // with the source polygon's membership before clipping them independently.
  const probe:[number,number]=[0,0];
  const parity=rings.reduce((n,ring)=>n+Number(geoContains(ring,probe)),0)%2>0;
  value={rings,invert:parity!==geoContains({type:"MultiPolygon",coordinates},probe)};prepared.set(feature,value);return value;
}

/** Matches chart stars, while spherical streaming clips/resamples polygon boundaries. */
export function skyPolygonProjection(frame:EquatorialPoint,focus:EquatorialPoint,scale:number,mirrored=false,rotation=0,overview=false,width=600,height=600) {
  const offset=orientChartPoint(stereographicProject(focus.ra,focus.dec,frame.ra,frame.dec,scale)??{x:0,y:0},mirrored,rotation);
  return geoStereographic().rotate([-frame.ra,-frame.dec]).reflectX(!mirrored).angle(-rotation)
    .scale(scale*360/Math.PI).translate([width/2-offset.x,height/2-offset.y])
    .clipAngle(overview?90:96).clipExtent([[0,0],[width,height]]).precision(.15);
}
export function milkyWayPaths(features:MilkyWayFeature[],frame:EquatorialPoint,focus:EquatorialPoint,scale:number,mirrored=false,rotation=0,overview=false,width=600,height=600) {
  const path=geoPath(skyPolygonProjection(frame,focus,scale,mirrored,rotation,overview,width,height));
  return features.flatMap(feature=>{
    // Stream rings individually. The source's large northern hole otherwise
    // makes circle clipping interpret the complement as a filled hemisphere.
    // Even-odd fill combines the real outer boundary and its holes afterwards.
    const rings=new Map<string,boolean>(),source=prepare(feature);
    for(const geometry of [...source.rings,...(source.invert?[{type:"Sphere" as const}]:[])]){
      const d=path(geometry);if(d)rings.set(d,!rings.get(d));
    }
    const d=Array.from(rings).filter(([,visible])=>visible).map(([d])=>d).join(" ");
    return d?[{d,id:feature.id}]:[];
  });
}
