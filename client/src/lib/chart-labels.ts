export interface LabelBox {left:number;top:number;right:number;bottom:number;}
export function boxesOverlap(a:LabelBox,b:LabelBox,gap=0){return !(a.right+gap<b.left||a.left-gap>b.right||a.bottom+gap<b.top||a.top-gap>b.bottom);}
export function labelFits(box:LabelBox,viewport:LabelBox,circle?:{x:number;y:number;r:number}){
  if(box.left<viewport.left||box.right>viewport.right||box.top<viewport.top||box.bottom>viewport.bottom)return false;
  return !circle||[[box.left,box.top],[box.right,box.top],[box.left,box.bottom],[box.right,box.bottom]].every(([x,y])=>(x-circle.x)**2+(y-circle.y)**2<=circle.r**2);
}
