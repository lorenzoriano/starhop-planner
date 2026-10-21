export interface LabelBox {left:number;top:number;right:number;bottom:number;}
export function boxesOverlap(a:LabelBox,b:LabelBox,gap=0){return !(a.right+gap<b.left||a.left-gap>b.right||a.bottom+gap<b.top||a.top-gap>b.bottom);}
export function labelFits(box:LabelBox,viewport:LabelBox,circle?:{x:number;y:number;r:number}){
  if(box.left<viewport.left||box.right>viewport.right||box.top<viewport.top||box.bottom>viewport.bottom)return false;
  return !circle||[[box.left,box.top],[box.right,box.top],[box.left,box.bottom],[box.right,box.bottom]].every(([x,y])=>(x-circle.x)**2+(y-circle.y)**2<=circle.r**2);
}

export interface LabelPoint { id:string; x:number; y:number; occludable?:boolean; identity?:string; }
/** Distance to the visible label, rather than its text anchor (which can be a
 * whole word away from the nearest edge). Labels may never adopt another dot. */
export function pointLabelDistance(point:{x:number;y:number},box:LabelBox){
  return Math.hypot(Math.max(box.left-point.x,0,point.x-box.right),Math.max(box.top-point.y,0,point.y-box.bottom));
}
export function labelBelongsToPoint(box:LabelBox,owner:LabelPoint,points:readonly LabelPoint[],maximumGap:number){
  const dx=Math.max(box.left-owner.x,0,owner.x-box.right),dy=Math.max(box.top-owner.y,0,owner.y-box.bottom);
  const gapSquared=dx*dx+dy*dy;
  if(gapSquared>maximumGap*maximumGap)return false;
  const competingDistance=(Math.sqrt(gapSquared)+.01)**2;
  for(const point of points){
    if(point.id===owner.id||(owner.identity&&point.identity===owner.identity&&(point.x-owner.x)**2+(point.y-owner.y)**2<maximumGap*maximumGap/144)||(point.x-owner.x)**2+(point.y-owner.y)**2<.0001)continue;
    const x=Math.max(box.left-point.x,0,point.x-box.right),y=Math.max(box.top-point.y,0,point.y-box.bottom);
    const squared=x*x+y*y;
    if(point.occludable&&squared===0)continue;
    if(squared<=competingDistance)return false;
  }
  return true;
}

/** Limit collision work to a small region even when a detailed finder field
 * contains thousands of background stars. */
export function labelPointLookup(points:readonly LabelPoint[],cellSize:number){
  const cells=new Map<string,LabelPoint[]>();
  for(const point of points){const key=`${Math.floor(point.x/cellSize)},${Math.floor(point.y/cellSize)}`;const cell=cells.get(key)??[];cell.push(point);cells.set(key,cell);}
  return (box:LabelBox,margin:number)=>{
    const found:LabelPoint[]=[];
    for(let x=Math.floor((box.left-margin)/cellSize);x<=Math.floor((box.right+margin)/cellSize);x++)for(let y=Math.floor((box.top-margin)/cellSize);y<=Math.floor((box.bottom+margin)/cellSize);y++)found.push(...(cells.get(`${x},${y}`)??[]));
    return found;
  };
}

/** Every catalog marker, including double stars, reserves space for its glyph. */
export function constellationSymbolBox(star:{type:string;mag:number},point:{x:number;y:number},unit:number,selected=false):LabelBox|null {
  if(star.type==='star'&&star.mag>3)return null;
  const radius=(selected?12:6)*unit;
  return {left:point.x-radius,right:point.x+radius,top:point.y-radius,bottom:point.y+radius};
}

/** Squared distance to a drawn figure segment, including its endpoints. */
export function pointSegmentDistanceSquared(point:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number}) {
 const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
 return (point.x-a.x-t*dx)**2+(point.y-a.y-t*dy)**2;
}
