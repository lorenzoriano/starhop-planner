export type Page = "tonight"|"binocular"|"moon"|"hop"|"night"|"image";
const paths:Record<Page,string>={tonight:"/",binocular:"/binoculars",moon:"/moon",hop:"/hop",night:"/planner",image:"/image"};
export function pageForPath(path:string):Page|null {
  const base=path.split("?")[0].replace(/\/$/,"")||"/";
  if(/^\/hop\/[^/]+$/.test(base))return "hop";
  return Object.entries(paths).find(([,value])=>value===base)?.[0] as Page??null;
}
export function pathForPage(page:Page,targetId?:string) {return paths[page]+(page==="hop"&&targetId?`/${encodeURIComponent(targetId)}`:"");}
export function targetFromPath(path:string) {const match=path.match(/^\/hop\/([^/?]+)/);if(!match)return null;try{return decodeURIComponent(match[1]);}catch{return null;}}
