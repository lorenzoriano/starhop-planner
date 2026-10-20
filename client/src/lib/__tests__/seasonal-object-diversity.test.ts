import { describe, expect, it } from 'vitest';
import { clockSeason } from '../astronomical-clock';

const targets=[
  {id:'M42',name:'Orion Nebula',ra:83.8221,dec:-5.3911},
  {id:'M13',name:'Hercules Globular',ra:250.4235,dec:36.4613},
  {id:'M31',name:'Andromeda Galaxy',ra:10.6847,dec:41.269},
  {id:'Polaris',name:'Polaris',ra:37.9546,dec:89.2641},
  {id:'NGC5139',name:'Omega Centauri',ra:201.697,dec:-47.479},
];
describe('seasonal geometry across different kinds of targets',()=>{
  it('distinguishes winter, summer and autumn targets and the near pole',()=>{
    const seasons=['2026-01-15','2026-07-15','2026-10-15'].map(day=>clockSeason({targets,lat:37.77,lon:-122.42,zone:'America/Los_Angeles',from:day,to:day,minAlt:30,minSeparation:30}));
    expect(seasons[0].days[0].available[0]).toBeGreaterThan(seasons[1].days[0].available[0]);
    expect(seasons[1].days[0].available[1]).toBeGreaterThan(seasons[0].days[0].available[1]);
    expect(seasons[2].days[0].available[2]).toBeGreaterThan(seasons[1].days[0].available[2]);
    for(const result of seasons){
      const polar=result.trajectories[0].alt[3];
      expect(Math.min(...polar)).toBeGreaterThan(36);
      expect(Math.max(...polar)).toBeLessThan(40);
      expect(result.days[0].available[3]).toBeGreaterThan(5);
      expect(result.days[0].available[4]).toBe(0);
      result.days[0].moonFree.forEach((hours,index)=>{expect(hours).toBeGreaterThanOrEqual(0);expect(hours).toBeLessThanOrEqual(result.days[0].available[index]);});
    }
  });
  it('reverses the pole and southern-target behavior at Sydney',()=>{
    const result=clockSeason({targets,lat:-33.87,lon:151.21,zone:'Australia/Sydney',from:'2026-04-15',to:'2026-04-15',minAlt:30,minSeparation:30});
    expect(result.days[0].available[3]).toBe(0);
    expect(result.days[0].available[4]).toBeGreaterThan(4);
  });
});
