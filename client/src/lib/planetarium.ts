/** Catalog symbols identify object classes; they are not simulated eyepiece images. */
export function skyObjectKind(category='') {
  if(/galaxy/i.test(category))return 'galaxy';
  if(/globular/i.test(category))return 'globular';
  if(/cluster/i.test(category))return 'cluster';
  if(/nebula|remnant/i.test(category))return 'nebula';
  if(/asterism|patch/i.test(category))return 'field';
  return 'stellar';
}
export function isDeepSky(category?:string) {return skyObjectKind(category)!=='stellar';}
/** Stereographic radial distance from zenith, as a fraction of the horizon radius. */
export function altitudeRingFraction(altitude:number) {return Math.tan((90-altitude)*Math.PI/360);}
