import type { LunarFrame } from "./moon";

/** Visible viewport only: zoom samples fresh map detail instead of enlarging a fixed disk. */
export function renderLunarViewport(texture:ImageData, frame:LunarFrame, size:number, width:number, stageScale:number, radius:number, pan:{x:number;y:number}, rotation:number, mirrored:boolean, reference:boolean) {
  const pixels=new Uint8ClampedArray(size*size*4), angle=rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const gray=(xx:number,yy:number)=>{const t=(Math.max(0,Math.min(texture.height-1,yy))*texture.width+((xx%texture.width+texture.width)%texture.width))*4;return .2126*texture.data[t]+.7152*texture.data[t+1]+.0722*texture.data[t+2];};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const vx=((x+.5)/size*width-width/2)/stageScale-pan.x,vy=((y+.5)/size*width-width/2)/stageScale-pan.y;
    const nx=(vx*c+vy*s)/radius*(mirrored?-1:1),ny=-(-vx*s+vy*c)/radius,r2=nx*nx+ny*ny;
    if(r2>1)continue;
    const z=Math.sqrt(1-r2),a=z*frame.observer[0]+nx*frame.right[0]+ny*frame.up[0],b=z*frame.observer[1]+nx*frame.right[1]+ny*frame.up[1],d=z*frame.observer[2]+nx*frame.right[2]+ny*frame.up[2];
    const u=(Math.atan2(b,a)/(2*Math.PI)+.5)*texture.width-.5,v=(.5-Math.asin(Math.max(-1,Math.min(1,d)))/Math.PI)*texture.height-.5;
    const ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy;
    const value=(gray(ix,iy)*(1-fx)+gray(ix+1,iy)*fx)*(1-fy)+(gray(ix,iy+1)*(1-fx)+gray(ix+1,iy+1)*fx)*fy;
    const sunlight=a*frame.sun[0]+b*frame.sun[1]+d*frame.sun[2],shade=reference?1:sunlight<=0?.025:Math.min(1,.48+.52*Math.sqrt(sunlight));
    const o=(y*size+x)*4;pixels[o]=pixels[o+1]=pixels[o+2]=value*shade;pixels[o+3]=255;
  }
  return pixels;
}

export function separationScale(values:number[],full=false) {
  if(full||!values.length)return {min:0,max:180};
  let min=Math.max(0,Math.floor(Math.min(...values)/5)*5),max=Math.min(180,Math.ceil(Math.max(...values)/5)*5);
  if(max-min<10){min=Math.max(0,min-5);max=Math.min(180,min+10);min=Math.max(0,max-10);}
  return {min,max};
}
