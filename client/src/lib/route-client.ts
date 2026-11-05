import { planRoutes, type ObservingParams } from './astronomy';
import { planChain, type PlanChainOptions } from './hop-chain';
import type { ChainResult, ChainStop, LegReport } from './object-links';
let current:Worker|null=null,rejectCurrent:((e:Error)=>void)|null=null;
/** Each new request terminates obsolete graph work; all computation stays off the UI thread. */
export function planRoutesInWorker(params:ObservingParams):ReturnType<typeof planRoutes> {
  if(typeof Worker==='undefined')return planRoutes(params);
  current?.terminate();rejectCurrent?.(new DOMException('Superseded route','AbortError'));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./route-worker.ts',import.meta.url),{type:'module'});current=worker;rejectCurrent=reject;
    const finish=()=>{worker.terminate();if(current===worker){current=null;rejectCurrent=null;}};
    worker.onmessage=e=>{finish();e.data.error?reject(new Error(e.data.error)):resolve(e.data.value);};
    worker.onerror=()=>{finish();reject(new Error('Route worker unavailable. Reload the app and try again.'));};
    worker.postMessage({params,base:document.baseURI});
  });
}

// Chained hops run in one long-lived worker so its per-leg memo survives between requests (a new stop range, a
// replan after a setting change). Legs run one after another; an abort stops the chain at the next leg boundary.
let chainWorker:Worker|null=null,nextChainId=1;
const chainRequests=new Map<number,{resolve:(value:ChainResult)=>void;reject:(error:Error)=>void;onLeg?:(leg:LegReport)=>void}>();
const abortError=()=>new DOMException('Superseded hop sequence','AbortError');
function getChainWorker():Worker {
  if(chainWorker)return chainWorker;
  const worker=new Worker(new URL('./route-worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=(e:MessageEvent<{type:'leg'|'done'|'error';id:number;leg?:LegReport;value?:ChainResult;error?:string;aborted?:boolean}>)=>{
    const request=chainRequests.get(e.data.id);if(!request)return;
    if(e.data.type==='leg'){request.onLeg?.(e.data.leg!);return;}
    chainRequests.delete(e.data.id);
    if(e.data.type==='done')request.resolve(e.data.value!);
    else request.reject(e.data.aborted?abortError():new Error(e.data.error));
  };
  worker.onerror=()=>{worker.terminate();if(chainWorker===worker)chainWorker=null;for(const [id,request] of Array.from(chainRequests)){chainRequests.delete(id);request.reject(new Error('Route worker unavailable. Reload the app and try again.'));}};
  return chainWorker=worker;
}
/** Plan a chained hop off the UI thread (planChain in the route worker). Rejects with an AbortError when `signal` aborts. */
export function planChainInWorker(params:ObservingParams,stops:ChainStop[],opts:Pick<PlanChainOptions,'signal'|'onLeg'|'maxLegDeg'>={}):Promise<ChainResult> {
  if(opts.signal?.aborted)return Promise.reject(abortError());
  if(typeof Worker==='undefined')return planChain(params,stops,opts);
  const worker=getChainWorker(),id=nextChainId++;
  return new Promise<ChainResult>((resolve,reject)=>{
    chainRequests.set(id,{resolve,reject,onLeg:opts.onLeg});
    opts.signal?.addEventListener('abort',()=>{if(!chainRequests.delete(id))return;worker.postMessage({type:'abort',id});reject(abortError());},{once:true});
    worker.postMessage({type:'chain',id,params,stops,maxLegDeg:opts.maxLegDeg,base:document.baseURI});
  });
}
