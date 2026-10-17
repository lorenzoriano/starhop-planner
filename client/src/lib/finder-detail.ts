/** Catalog sizes are arcminutes unless explicitly marked degrees or arcseconds.
 * Uses the major diameter; this is a locating outline, not a simulated object.
 */
export function catalogDiameter(size:string|undefined):number|null {
  if(!size)return null;const value=parseFloat(size);
  if(!Number.isFinite(value)||value<=0)return null;
  const diameter=/°|deg/i.test(size)?value:/″|arcsec|"/.test(size)?value/3600:value/60;
  return diameter<=30?diameter:null;
}
