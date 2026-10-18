/** Display colors from catalog temperature, or B−V via Ballesteros (2012).
 * Planck spectral ratios at representative RGB wavelengths, white-balanced at
 * 6500 K. This is a display approximation; marker radius encodes magnitude,
 * never physical stellar diameter. Unknown colors remain neutral.
 */
export function temperatureFromBV(bv:number) {
  return 4600*(1/(.92*bv+1.7)+1/(.92*bv+.62));
}
export function stellarColor(temperature?:number,bv?:number):string {
  const t=typeof temperature==='number'&&Number.isFinite(temperature)&&temperature>0?temperature:typeof bv==='number'&&Number.isFinite(bv)&&bv>=-.4&&bv<=2.5?temperatureFromBV(bv):null;
  if(!t)return '#e4e7eb';
  const temp=Math.max(1800,Math.min(40000,t)),wavelengths=[650,550,450];
  const values=wavelengths.map(n=>Math.expm1(14387768/(n*6500))/Math.expm1(14387768/(n*temp)));
  const max=Math.max(...values),rgb=values.map(v=>Math.round(255*Math.pow(v/max,1/2.2)));
  return `rgb(${rgb.join(',')})`;
}
export function stellarRadius(mag:number) {return Math.max(.35,3.1*Math.pow(10,-.14*(mag+1)));}
