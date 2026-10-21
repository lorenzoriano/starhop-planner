import { describe, expect, it } from "vitest";
import { derivedNightName, detailedUnavailableReason, isDerivedNightName } from "@/components/SessionPlanner";
import type { UnifiedTarget } from "../astronomy";
import {sessionTimelineItems,type ObservingSession,type SequenceStep} from "../session-planner";

const zone="America/Los_Angeles";
const session:ObservingSession={id:"test",name:"Test night",startAt:"2026-10-20T10:00:00.000Z",lat:37.77,lon:-122.42,locationName:"",durationMinutes:180,minutesPerTarget:15,items:[],archived:false,createdAt:"2026-10-01T00:00:00.000Z"};
const step:SequenceStep={id:"test-target",name:"Test target",date:null,alt:-30,az:0,separation:null,moonlight:0,lunar:false,reason:"No usable slot"};
const target:UnifiedTarget={id:"test-target",name:"Far south",displayName:"Far south",aliases:[],mag:5,ra:13,dec:-80,con:"",category:"Globular cluster",categoryShort:"Cluster",source:"binocular",desc:""};

describe("planner convenience behavior",()=>{
  it("recognizes generated night names so only those names follow date changes",()=>{
    const generated=derivedNightName("2026-10-24",zone);
    expect(generated).toBe("Oct 24 observing night");
    expect(isDerivedNightName(generated,"2026-10-24",zone)).toBe(true);
    expect(isDerivedNightName("Star party", "2026-10-24",zone)).toBe(false);
    expect(isDerivedNightName(generated,"2026-10-26",zone)).toBe(false);
  });

  it("explains a target that never clears the altitude requirement",()=>{
    expect(detailedUnavailableReason(step,session,target,zone)).toMatch(/Never rises above 15° from this latitude/);
  });
  it("does not recommend a daylight rise for M13 during a pre-dawn session",()=>{
    const morning={...session,startAt:'2026-10-20T11:30:00Z',durationMinutes:60};
    const m13={...target,id:'M13',name:'Great Hercules Globular',ra:250.425,dec:36.46};
    const reason=detailedUnavailableReason({...step,id:'M13'},morning,m13,zone);
    expect(reason).not.toMatch(/Rises above 15° at 09:20/);
    expect(reason).toContain("Not above 15° in darkness during this session");
    expect(reason).toContain("next rise is in daylight");
  });

  it("numbers timeline targets by scheduled slots rather than order added",()=>{
    const items=['Mel20','M31','AST-JobsCoffin','M13'].map(id=>({id,addedAt:session.createdAt,notes:''}));
    const steps=[{...step,id:'M31',date:new Date('2026-11-09T03:03Z')},{...step,id:'AST-JobsCoffin',date:new Date('2026-11-09T02:48Z')},{...step,id:'Mel20',date:new Date('2026-11-09T03:18Z')},{...step,id:'M13'}];
    expect(sessionTimelineItems(items,steps).map(item=>item.id)).toEqual(['AST-JobsCoffin','M31','Mel20','M13']);
    expect(items[0].id).toBe('Mel20');
  });

});
