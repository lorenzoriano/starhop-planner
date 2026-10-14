import type { UnifiedTarget } from "./astronomy";

export function normalizedSearch(value:string) {
  return value.trim().toLowerCase().replace(/\bmessier\s*(\d+)/g,"m$1").replace(/\b(m|ngc|ic|hr)\s+(\d+)/g,"$1$2").replace(/\s+/g," ");
}
/** Exact identifiers win; astronomical suitability keeps its order within each tier. */
export function catalogSearchScore(target:UnifiedTarget,query:string,extra="") {
  const q=normalizedSearch(query);if(!q)return 0;
  const ids=[target.id,...(target.aliases??[])].map(normalizedSearch);
  const names=[target.name,target.displayName].map(normalizedSearch);
  if(ids.includes(q))return 0;
  if(names.includes(q))return 1;
  if(ids.some(id=>id.startsWith(q)))return 2;
  if(names.some(name=>name.startsWith(q)))return 3;
  return [...ids,...names,normalizedSearch(`${target.category} ${extra}`)].some(value=>value.includes(q))?4:Infinity;
}
