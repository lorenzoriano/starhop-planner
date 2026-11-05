export type Page = "catalog"|"tonight"|"journeys"|"binocular"|"moon"|"hop"|"night"|"image"|"clock";
const paths:Record<Page,string>={clock:"/clock",catalog:"/catalog",tonight:"/",journeys:"/journeys",binocular:"/binoculars",moon:"/moon",hop:"/hop",night:"/planner",image:"/image"};
/** Sky Journeys sub-routes: #/journeys, #/journeys/:key, #/journeys/:key/stop/:n (1-based), #/journeys/:key/done. */
const JOURNEY_PATH=/^\/journeys(?:\/([^/?]+)(?:\/(?:stop\/([1-9]\d?)|(done)))?)?$/;
export function pageForPath(path:string):Page|null {
  const base=path.split("?")[0].replace(/\/$/,"")||"/";
  if(/^\/hop\/[^/]+$/.test(base))return "hop";
  if(JOURNEY_PATH.test(base))return "journeys";
  return Object.entries(paths).find(([,value])=>value===base)?.[0] as Page??null;
}
export function pathForPage(page:Page,targetId?:string) {return paths[page]+((page==="hop"||page==="journeys")&&targetId?`/${encodeURIComponent(targetId)}`:"");}
export function targetFromPath(path:string) {const match=path.match(/^\/hop\/([^/?]+)/);if(!match)return null;try{return decodeURIComponent(match[1]);}catch{return null;}}

export type JourneyRoute =
  | { view: "discover" }
  | { view: "overview"; key: string }
  | { view: "stop"; key: string; /** 1-based, as in the URL */ stop: number }
  | { view: "done"; key: string };
/** Parse a Journeys hash path; null when the path is not a valid Journeys route. */
export function journeyRouteFromPath(path:string):JourneyRoute|null {
  const base=path.split("?")[0].replace(/\/$/,"")||"/";
  const match=base.match(JOURNEY_PATH);
  if(!match)return null;
  if(!match[1])return {view:"discover"};
  let key:string;
  try{key=decodeURIComponent(match[1]);}catch{return null;}
  if(!key)return null;
  if(match[2])return {view:"stop",key,stop:Number(match[2])};
  if(match[3])return {view:"done",key};
  return {view:"overview",key};
}
export function pathForJourneyRoute(route:JourneyRoute):string {
  if(route.view==="discover")return paths.journeys;
  const base=`${paths.journeys}/${encodeURIComponent(route.key)}`;
  if(route.view==="stop")return `${base}/stop/${Math.max(1,Math.min(99,Math.round(route.stop)))}`;
  if(route.view==="done")return `${base}/done`;
  return base;
}

// ───────── query-carrying hash routes (cross-tab links, integration r5) ─────────
// The query lives inside the hash (#/hop/M42?journey=K). wouter's hash `navigate` moves "?…" into the page URL's
// search instead, so links that carry a query must use navigateHash (or a plain <a href={"#"+path}>).
const queryOf=(path:string)=>new URLSearchParams(path.includes("?")?path.slice(path.indexOf("?")+1):"");
const withQuery=(base:string,query:URLSearchParams)=>{const text=query.toString();return text?`${base}?${text}`:base;};
const stopNumber=(value:string|null)=>value&&/^[1-9]\d?$/.test(value)?Number(value):undefined;

/** Star hop context carried in the URL. Stop and leg numbers are 1-based; `chain` is an inclusive stop range. */
export interface HopLocation { targetId:string; journey?:{key:string;stop?:number;/** Opened from the journey Overview (`&from=overview`): "Back to journey" returns there. */from?:"overview"}; chain?:{from:number;to:number}; leg?:number }
/** `#/hop/<id>?journey=KEY&stop=N` (single hop from a journey stop) or `?journey=KEY&chain=1-5&leg=3` (chained hop). */
export function hopPath(targetId:string,o:Omit<HopLocation,"targetId">={}):string {
  const query=new URLSearchParams();
  if(o.journey){query.set("journey",o.journey.key);if(o.journey.stop)query.set("stop",String(o.journey.stop));if(o.journey.from==="overview")query.set("from","overview");}
  if(o.chain)query.set("chain",`${o.chain.from}-${o.chain.to}`);
  if(o.leg)query.set("leg",String(o.leg));
  return withQuery(pathForPage("hop",targetId),query);
}
/** Parse a Star hop location (with or without its query); null when it is not `/hop/<id>`. */
export function parseHopLocation(path:string):HopLocation|null {
  const targetId=targetFromPath(path);
  if(!targetId)return null;
  const query=queryOf(path),key=query.get("journey"),stop=stopNumber(query.get("stop")),chain=query.get("chain")?.match(/^([1-9]\d?)-([1-9]\d?)$/),leg=stopNumber(query.get("leg"));
  return {targetId,...(key?{journey:{key,...(stop?{stop}:{}),...(query.get("from")==="overview"?{from:"overview" as const}:{})}}:{}),...(chain&&+chain[1]<=+chain[2]?{chain:{from:+chain[1],to:+chain[2]}}:{}),...(leg?{leg}:{})};
}
/** `#/journeys/<key>?stop=n`: the journey Overview with stop n's card open (1-based; "Back to journey" from a hop opened there). */
export const journeyOverviewStopPath=(key:string,stop:number)=>withQuery(pathForJourneyRoute({view:"overview",key}),new URLSearchParams({stop:String(Math.max(1,Math.min(99,Math.round(stop))))}));
/** `#/catalog?object=<id>` ("See in Catalog"), `&photos=1` ("Photos"). */
export function catalogPath(objectId:string,o:{photos?:boolean}={}):string {
  const query=new URLSearchParams({object:objectId});if(o.photos)query.set("photos","1");
  return withQuery(paths.catalog,query);
}
export function parseCatalogLocation(path:string):{objectId?:string;photos:boolean} {
  const query=queryOf(path),objectId=query.get("object")??undefined;
  return {...(objectId?{objectId}:{}),photos:query.get("photos")==="1"};
}
/** `#/journeys?focus=<id>`: Discovery showing journeys through this object first. */
export const journeysFocusPath=(objectId:string)=>withQuery(paths.journeys,new URLSearchParams({focus:objectId}));
export const journeyFocusFromPath=(path:string)=>queryOf(path).get("focus")??null;
/** Hash navigation that keeps a "?query" inside the hash (same events as wouter's navigate, so useLocation updates). */
export function navigateHash(path:string,{replace=false}:{replace?:boolean}={}) {
  const oldURL=location.href,url=new URL(location.href);
  url.hash=path.startsWith("/")?path:`/${path}`;
  if(replace)history.replaceState(null,"",url.href);else history.pushState(null,"",url.href);
  dispatchEvent(typeof HashChangeEvent!=="undefined"?new HashChangeEvent("hashchange",{oldURL,newURL:url.href}):new Event("hashchange"));
}
