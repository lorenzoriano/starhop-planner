import { planRoutes, type ObservingParams } from './astronomy';
self.onmessage=async(event:MessageEvent<{params:ObservingParams;base:string}>)=>{
  const original=self.fetch.bind(self);
  self.fetch=((input:RequestInfo|URL,init?:RequestInit)=>original(typeof input==='string'?new URL(input,event.data.base):input,init)) as typeof fetch;
  try{self.postMessage({value:await planRoutes(event.data.params)});}catch(error){self.postMessage({error:error instanceof Error?error.message:'Could not calculate this route.'});}
};
