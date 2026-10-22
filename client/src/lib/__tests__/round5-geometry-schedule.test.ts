import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Astro from 'astronomy-engine';
import { chartSolarSystemPositions, buildUnifiedTargets, loadMessier, loadBinocularTargets, eqToHorizontal, type UnifiedTarget } from '../astronomy';
import { skyPolygonProjection } from '../sky-polygons';
import { projectChartPoint } from '../chart-view';
import { orientChartPoint } from '../observing';
import { makeSession, suggestSequence, sessionFreeGaps } from '../session-planner';

vi.stubGlobal('fetch', async (input:string) => new Response(readFileSync(resolve(__dirname,'../../../public',input.replace(/^\.\//,'')),'utf8'),{status:200}));
afterAll(()=>vi.unstubAllGlobals());
let targets:UnifiedTarget[];
beforeAll(async()=>{targets=buildUnifiedTargets(await loadMessier(),await loadBinocularTargets());});

describe('wide projection and visible solar system',()=>{
 it('keeps polygon and point coordinates aligned at measured widths and all orientations',()=>{
  const frame={ra:305,dec:40},focus={ra:307,dec:42},point={ra:310,dec:41};
  for(const width of [600,750,1000,1400])for(const mirror of [false,true])for(const rotation of [0,90,180,270]){
   const actual=skyPolygonProjection(frame,focus,12,mirror,rotation,false,width,600)([point.ra,point.dec])!;
   const expected=orientChartPoint(projectChartPoint(point,frame,focus,12)!,mirror,rotation);
   expect(actual[0]).toBeCloseTo(width/2+expected.x,6);expect(actual[1]).toBeCloseTo(300+expected.y,6);
  }
 });
 it.each(['2026-10-21T04:00:00Z','2026-11-09T06:00:00Z','2026-10-21T19:00:00Z'])('shows every above-horizon planet and Moon at %s without route-anchor cuts',stamp=>{
  const date=new Date(stamp),observer=new Astro.Observer(37.77,-122.42,0),nodes=chartSolarSystemPositions(37.77,-122.42,date);
  for(const body of [Astro.Body.Mercury,Astro.Body.Venus,Astro.Body.Mars,Astro.Body.Jupiter,Astro.Body.Saturn,Astro.Body.Moon]){
   const ofDate=Astro.Equator(body,date,observer,true,true),j2000=Astro.Equator(body,date,observer,false,true);
   const horizon=Astro.Horizon(date,observer,ofDate.ra,ofDate.dec,'normal'),node=nodes.find(n=>n.name===body);
   expect(!!node).toBe(horizon.altitude>0);
   if(node){expect(node.ra).toBeCloseTo(j2000.ra*15,7);expect(node.dec).toBeCloseTo(j2000.dec,7);expect(node.alt).toBeCloseTo(horizon.altitude,7);}
  }
 });
});

describe('joint observing time and order',()=>{
 it.each([
  ['2026-11-09T03:00:00Z',120,20,['M31','M45','AST-Hyades','M36','M37']],
  ['2026-11-21T03:00:00Z',240,15,['M15','M31','M45','M36','M37']],
  ['2026-12-06T03:00:00Z',300,15,['M31','M45','M36','M37']],
 ] as const)('improves packed/rising targets without overlap for %s', (stamp,minutes,slot,ids)=>{
  const start=new Date(stamp),session=makeSession('Regression',start,37.77,-122.42,ids.map(id=>({id,notes:'',addedAt:stamp})));
  session.durationMinutes=minutes;session.minutesPerTarget=slot;
  const steps=suggestSequence(session,targets,19),scheduled=steps.filter(s=>s.date);
  expect(scheduled.length).toBe(ids.length);
  for(let i=0;i<scheduled.length;i++){
   const step=scheduled[i],target=targets.find(t=>t.id===step.id)!;
   if(i)expect(+step.date!).toBeGreaterThanOrEqual(+scheduled[i-1].date!+slot*60000);
   const later=eqToHorizontal(target.ra,target.dec,37.77,-122.42,new Date(+step.date!+10*60000)).alt;
   if(later>step.alt+.2)expect(step.reason).not.toContain('window closes');
   // Independently scan all slots that do not displace another object.
   let feasibleBest=step.alt;
   for(let ms=+start;ms+slot*60000<=+start+minutes*60000;ms+=5*60000){
    if(scheduled.some(other=>other.id!==step.id&&ms<+other.date!+slot*60000&&ms+slot*60000>+other.date!))continue;
    const alt=eqToHorizontal(target.ra,target.dec,37.77,-122.42,new Date(ms)).alt;
    const finish=eqToHorizontal(target.ra,target.dec,37.77,-122.42,new Date(ms+slot*60000)).alt;
    if(finish>=15)feasibleBest=Math.max(feasibleBest,alt);
   }
   expect(feasibleBest-step.alt).toBeLessThanOrEqual(10);
  }
  const gaps=sessionFreeGaps(session,steps);
  expect(gaps.length).toBeGreaterThan(0);
  expect(gaps.every(g=>+g.end>+g.start)).toBe(true);
 });
});
