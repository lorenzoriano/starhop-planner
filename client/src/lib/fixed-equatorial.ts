import * as Astro from 'astronomy-engine';
let rotationTime=NaN,forward:Astro.RotationMatrix,backward:Astro.RotationMatrix;
function rotations(date:Date) {
  if(+date!==rotationTime){rotationTime=+date;forward=Astro.Rotation_EQJ_EQD(date);backward=Astro.InverseRotation(forward);}
  return {forward,backward};
}
/** Catalog J2000 → true equator/equinox of date (precession and nutation). No invented proper motion. */
export function equatorialOfDate(ra:number,dec:number,date:Date,inverse=false) {
  const rotation=rotations(date)[inverse?'backward':'forward'];
  const v=Astro.VectorFromSphere(new Astro.Spherical(dec,ra,1),date);
  const q=Astro.EquatorFromVector(Astro.RotateVector(rotation,v));
  return {ra:q.ra*15,dec:q.dec};
}
