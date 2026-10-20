import { describe, expect, it } from "vitest";
import { derivedNightName, detailedUnavailableReason, isDerivedNightName } from "@/components/SessionPlanner";
import type { UnifiedTarget } from "../astronomy";
import type { ObservingSession, SequenceStep } from "../session-planner";

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
});
