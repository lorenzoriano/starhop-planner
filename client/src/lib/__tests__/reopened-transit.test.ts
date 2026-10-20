import { describe,it,expect } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import { clockBounds,clockTargetEvents } from '../astronomical-clock';
import { targetIntervalEvents,targetDayEvents } from '../target-visibility';
const target={id:'M31',name:'Andromeda Galaxy',ra:10.6847,dec:41.269},lat=37.77,lon=-122.42,zone='America/Los_Angeles';
describe('events around two transits on one civil date',()=>{
  it('finds the late Oct 19 M31 transit inside the Oct 19–20 observing night',()=>{
    const result=clockTargetEvents(target,lat,lon,'2026-10-19',zone);
    expect(result.transit).not.toBeNull();
    expect(Math.abs(+result.transit!-+new Date('2026-10-20T06:58:48Z'))).toBeLessThan(60_000);
    expect(formatInTimeZone(result.transit!,zone,'yyyy-MM-dd HH:mm')).toBe('2026-10-19 23:58');
    const bounds=clockBounds('2026-10-19',zone);
    for(const event of [result.rise,result.transit,result.set])if(event){expect(+event).toBeGreaterThanOrEqual(+bounds.start);expect(+event).toBeLessThan(+bounds.end);}
  });
  it('retains both transits in the civil date instead of silently dropping the second',()=>{
    const day=targetDayEvents(target.ra,target.dec,lat,lon,new Date('2026-10-19T19:00:00Z'),zone);
    expect(day.events.transit).toHaveLength(2);
    const interval=targetIntervalEvents(target.ra,target.dec,lat,lon,new Date('2026-10-20T06:00:00Z'),new Date('2026-10-20T08:00:00Z'));
    expect(interval.transit).toEqual(day.events.transit[1]);
  });
});
