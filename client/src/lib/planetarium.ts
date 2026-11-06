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
/** Overhead-chart offset of a horizontal direction before orientation, like the chart's cardinals: north up, east left. */
export function overheadOffset(azDeg:number,radius:number) {
  const a=azDeg*Math.PI/180;
  return {x:-Math.sin(a)*radius,y:-Math.cos(a)*radius};
}
/**
 * SVG path of the local skyline as a silhouette on the overhead chart: the band between the horizon circle (`radius`)
 * and the skyline (radius·altitudeRingFraction(threshold) at each azimuth), filled with fill-rule evenodd. A skyline
 * below 0° leaves no band. `threshold` is the geometric skyline (horizonLookup) the chart's star altitudes compare with;
 * `orient` applies the chart's mirror/rotation (orientChartPoint).
 */
export function skylineSilhouettePath(threshold:(azDeg:number)=>number,orient:(p:{x:number;y:number})=>{x:number;y:number},cx:number,cy:number,radius=260,stepDeg=1) {
  return overheadRing(()=>radius,orient,cx,cy,stepDeg)+skylineRidgePath(threshold,orient,cx,cy,radius,stepDeg);
}
/** The skyline's ridge alone (the silhouette's inner edge), for drawing the outline of the hills over the sky. */
export function skylineRidgePath(threshold:(azDeg:number)=>number,orient:(p:{x:number;y:number})=>{x:number;y:number},cx:number,cy:number,radius=260,stepDeg=1) {
  return overheadRing(az=>radius*altitudeRingFraction(Math.max(0,Math.min(90,threshold(az)))),orient,cx,cy,stepDeg);
}
/** Highest point of a skyline threshold function, degrees (sampled every `stepDeg`). */
export function skylinePeakDeg(threshold:(azDeg:number)=>number,stepDeg=1) {
  const n=Math.max(8,Math.round(360/stepDeg));
  let peak=-90;
  for(let i=0;i<n;i++)peak=Math.max(peak,threshold(i*360/n));
  return peak;
}
function overheadRing(r:(az:number)=>number,orient:(p:{x:number;y:number})=>{x:number;y:number},cx:number,cy:number,stepDeg:number) {
  const n=Math.max(8,Math.round(360/stepDeg));
  return Array.from({length:n},(_,i)=>{
    const az=i*360/n,p=orient(overheadOffset(az,r(az)));
    return `${i?'L':'M'}${(cx+p.x).toFixed(2)},${(cy+p.y).toFixed(2)}`;
  }).join('')+'Z';
}
