import { binocularMedia } from './binocular-media';

export interface CalibratedPhoto {
  path:string; width:number; height:number; ra:number; dec:number; fieldWidth:number; fieldHeight:number;
}
const radians=(degrees:number)=>degrees*Math.PI/180;
const degrees=(angle:number)=>angle*180/Math.PI;

/** The bundled hips2fits images are north-up, east-left gnomonic (TAN) fields.
 * A portrait's dimensions alone never supply an angular calibration. */
export function calibratedOpticalPhoto(id:string):CalibratedPhoto|null {
  const media=binocularMedia(id),image=media?.images.find(photo=>photo.variant==='optical'&&photo.display!==false);
  if(!media||!image)return null;
  let url:URL;try{url=new URL(image.url);}catch{return null;}
  const p=url.searchParams,width=Number(p.get('width')),height=Number(p.get('height')),fov=Number(p.get('fov'));
  if(p.get('projection')!=='TAN'||p.get('coordsys')!=='icrs'||Number(p.get('rotation_angle'))!==0||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||!(fov>0&&fov<90))return null;
  // CDS defines fov along the largest pixel dimension, with an isotropic TAN scale.
  const pixelScale=2*Math.tan(radians(fov/2))/Math.max(width,height);
  return {path:image.path,width,height,ra:media.ra,dec:media.dec,fieldWidth:degrees(2*Math.atan(pixelScale*width/2)),fieldHeight:degrees(2*Math.atan(pixelScale*height/2))};
}

/** Uniform image scaling on its calibrated TAN plane. The optical opening stays
 * fixed on screen while a smaller angular field magnifies the survey photo. */
export function photoFrameGeometry(photo:CalibratedPhoto,fieldWidth:number,fieldHeight:number,shape:'circle'|'rectangle',opening=420) {
  if(![fieldWidth,fieldHeight].every(angle=>Number.isFinite(angle)&&angle>0&&angle<90))throw new RangeError('Optical field must be between 0 and 90 degrees.');
  const tangentWidth=2*Math.tan(radians(fieldWidth/2)),tangentHeight=shape==='circle'?tangentWidth:2*Math.tan(radians(fieldHeight/2));
  const scale=opening/Math.max(tangentWidth,tangentHeight),width=tangentWidth*scale,height=tangentHeight*scale;
  const imageWidth=2*Math.tan(radians(photo.fieldWidth/2))*scale,imageHeight=imageWidth*photo.height/photo.width;
  // hips2fits uses FITS CRPIX=(width/2,height/2). After north-up raster export,
  // the reference lies at (width/2-.5,height/2+.5) in pixel-edge coordinates.
  const imageX=-imageWidth/2+imageWidth/photo.width*.5,imageY=-imageHeight/2-imageHeight/photo.height*.5;
  return {width,height,imageWidth,imageHeight,imageX,imageY,scale,coverageComplete:imageX<=-width/2&&imageY<=-height/2&&imageX+imageWidth>=width/2&&imageY+imageHeight>=height/2};
}

/** Position in a north-up TAN plane; an object outside its front hemisphere
 * cannot be represented by this small-field image. */
export function photoTangentOffset(ra:number,dec:number,centerRa:number,centerDec:number):{x:number;y:number}|null {
  const delta=radians(ra-centerRa),latitude=radians(dec),center=radians(centerDec),cosDistance=Math.sin(center)*Math.sin(latitude)+Math.cos(center)*Math.cos(latitude)*Math.cos(delta);
  if(cosDistance<=0)return null;
  return {x:-Math.cos(latitude)*Math.sin(delta)/cosDistance,y:-(Math.cos(center)*Math.sin(latitude)-Math.sin(center)*Math.cos(latitude)*Math.cos(delta))/cosDistance};
}
