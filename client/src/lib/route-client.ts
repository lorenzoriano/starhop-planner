import { planRoutes, type ObservingParams } from './astronomy';
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
