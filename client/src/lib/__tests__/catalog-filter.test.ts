import { equatorialOfDate } from "../fixed-equatorial";
import { describe,it,expect } from 'vitest';
import { SiderealTime } from 'astronomy-engine';
import { catalogMatches,hoursFromTransit, type CatalogConstraints } from '../catalog-filter';
import { KITE_14X50 } from '../binocular-assessment';
import { visibilityWindow } from '../target-visibility';
import { moonState } from '../moon';
import type { UnifiedTarget } from '../astronomy';
import { pageForPath,pathForPage } from '../navigation';
const lat=37.77,lon=-122.42,start=new Date('2026-10-25T03:00Z'),end=new Date('2026-10-25T05:00Z');
const zenith=equatorialOfDate((SiderealTime(start)*15+lon+360)%360,lat,start,true),ra=zenith.ra;
const target:UnifiedTarget={id:'test',name:'Test field',displayName:'Test field',category:'Open Cluster',categoryShort:'Open Cl.',mag:5,ra,dec:zenith.dec,con:'Cyg',source:'binocular',size:'30′'};
const range={ok:true as const,start,end,segments:[{start,end}]};
const any:CatalogConstraints={minAltitude:-90,minMoonDistance:0,transitHours:null,maxRating:3};
describe('whole-catalog planning filters',()=>{
  it('finds the exact culmination and wraps transit across zero RA',()=>{
    const row=catalogMatches(target,lat,lon,range,{...any,minAltitude:89},KITE_14X50,21.6)!;
    expect(row.alt).toBeCloseTo(90,3);expect(+row.at).toBeCloseTo(+start,-3);
    expect(hoursFromTransit(ra+360,lon,start,zenith.dec)).toBeCloseTo(0,6);
    const opposite=equatorialOfDate((SiderealTime(start)*15+lon+180+360)%360,lat,start,true);expect(hoursFromTransit(opposite.ra,lon,start,opposite.dec)).toBeCloseTo(12,6);
  });
  it('requires altitude and Moon-distance constraints to hold at the same time',()=>{
    // Artificial lunar path separates the two constraints: far from Moon only after the target falls low.
    const base=moonState(lat,lon,start),moonAt=(date:Date)=>({...base,ra:target.ra+(+date-+start<3600000?0:170),dec:target.dec,sunAlt:-30,alt:-10});
    expect(catalogMatches(target,lat,lon,range,{...any,minAltitude:85,minMoonDistance:60},KITE_14X50,21.6,moonAt)).toBeNull();
    expect(catalogMatches(target,lat,lon,range,{...any,minAltitude:60,minMoonDistance:60},KITE_14X50,21.6,moonAt)).not.toBeNull();
  });
  it('handles a single moment, an overnight range and no astronomical night',()=>{
    const moment=visibilityWindow('2026-10-24','20:00','22:00','time','America/Los_Angeles',lat,lon);
    expect(catalogMatches(target,lat,lon,moment,any,KITE_14X50,21.6)?.at.toISOString()).toBe('2026-10-25T03:00:00.000Z');
    const overnight=visibilityWindow('2026-10-24','22:00','02:00','range','America/Los_Angeles',lat,lon);
    expect(overnight.ok&&+overnight.end-+overnight.start).toBe(4*3600000);
    const polar=visibilityWindow('2026-06-21','20:00','22:00','night','Europe/Oslo',69,18);
    expect(catalogMatches(target,69,18,polar,any,KITE_14X50,21.6)).toBeNull();
    expect(pageForPath('/catalog')).toBe('catalog');expect(pathForPage('catalog')).toBe('/catalog');
  });
});
