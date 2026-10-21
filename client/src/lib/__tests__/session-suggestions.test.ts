import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildUnifiedTargets,loadBinocularTargets,loadMessier,type UnifiedTarget} from '../astronomy';
import {sessionBinocularSuggestions} from '../session-suggestions';
import {makeSession} from '../session-planner';
import {KITE_14X50} from '../binocular-assessment';
vi.stubGlobal('fetch',async(input:string)=>new Response(readFileSync(resolve(__dirname,'../../../public',input.replace(/^\.\//,'')),'utf8'),{status:200}));
afterAll(()=>vi.unstubAllGlobals());
let targets:UnifiedTarget[];
beforeAll(async()=>{targets=buildUnifiedTargets(await loadMessier(),await loadBinocularTargets());});
describe('session binocular suggestions',()=>{
 it('keeps M31 and the Pleiades available on a dark autumn night and ranks by visual reward',()=>{
  const session={...makeSession('Dark night',new Date('2026-11-09T05:00:00Z'),37.77,-122.42),durationMinutes:180};
  const picks=sessionBinocularSuggestions(session,targets,KITE_14X50);
  expect(picks.find(p=>p.target.id==='M31')).toBeDefined();
  expect(picks.find(p=>p.target.id==='M45')).toBeDefined();
  expect(picks[0].fit).toBeLessThanOrEqual(picks.at(-1)!.fit);
  expect(picks.every(p=>p.alt>=15&&p.dark)).toBe(true);
 });
 it('does not offer deep-sky objects in daylight or objects already on the list',()=>{
  const session={...makeSession('Day',new Date('2026-11-09T20:00:00Z'),37.77,-122.42),durationMinutes:60};
  expect(sessionBinocularSuggestions(session,targets,KITE_14X50)).toHaveLength(0);
  const night={...session,startAt:'2026-11-09T05:00:00Z',items:[{id:'M31',addedAt:'2026-11-01T00:00:00Z',notes:'Keep'}]};
  expect(sessionBinocularSuggestions(night,targets,KITE_14X50).some(p=>p.target.id==='M31')).toBe(false);
  expect(night.items[0].notes).toBe('Keep');
 });
});
