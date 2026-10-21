export interface LabelBox {left:number;top:number;right:number;bottom:number;}
export function boxesOverlap(a:LabelBox,b:LabelBox,gap=0){return !(a.right+gap<b.left||a.left-gap>b.right||a.bottom+gap<b.top||a.top-gap>b.bottom);}
export function labelFits(box:LabelBox,viewport:LabelBox,circle?:{x:number;y:number;r:number}){
  if(box.left<viewport.left||box.right>viewport.right||box.top<viewport.top||box.bottom>viewport.bottom)return false;
  return !circle||[[box.left,box.top],[box.right,box.top],[box.left,box.bottom],[box.right,box.bottom]].every(([x,y])=>(x-circle.x)**2+(y-circle.y)**2<=circle.r**2);
}

export interface LabelPoint { id:string; x:number; y:number; occludable?:boolean; }
/** Distance to the visible label, rather than its text anchor (which can be a
 * whole word away from the nearest edge). Labels may never adopt another dot. */
export function pointLabelDistance(point:{x:number;y:number},box:LabelBox){
  return Math.hypot(Math.max(box.left-point.x,0,point.x-box.right),Math.max(box.top-point.y,0,point.y-box.bottom));
}
export function labelBelongsToPoint(box:LabelBox,owner:LabelPoint,points:readonly LabelPoint[],maximumGap:number){
  const gap=pointLabelDistance(owner,box);
  return gap<=maximumGap&&points.every(point=>{
    if(point.id===owner.id||Math.hypot(point.x-owner.x,point.y-owner.y)<.01)return true;
    const distance=pointLabelDistance(point,box);
    // A faint background dot completely behind the opaque label plate is not
    // a visible competing symbol. Bright stars and prominent catalog symbols cannot hide.
    if(point.occludable&&distance===0)return true;
    return distance>gap+.01;
  });
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
