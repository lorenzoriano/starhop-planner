import { describe, expect, it } from "vitest";
import { hoppableNightItems, journeyBadgeLabel, journeySkyMoment } from "@/components/SessionPlanner";
import { LINK_LABELS } from "../object-links";

// San Francisco night of Nov 3, 2026 (PST): session starts 18:45 local.
const session={startAt:"2026-11-04T02:45:00.000Z",lat:37.77,lon:-122.42};

describe("planner journey links",()=>{
  it("labels journey rows with the journey title and 1-based stop, leaving out what is unknown",()=>{
    expect(journeyBadgeLabel("Look-Alikes of Perseus",4)).toBe("Journey · Look-Alikes of Perseus · stop 4");
    expect(journeyBadgeLabel(undefined,3)).toBe("Journey · stop 3");
    expect(journeyBadgeLabel("Cradle to Grave")).toBe("Journey · Cradle to Grave");
    expect(journeyBadgeLabel("  ",undefined)).toBe("Journey");
    expect(journeyBadgeLabel()).toBe("Journey");
  });

  it("lists tonight's journeys at the observing moment when the session is the same night, else at the session start",()=>{
    const evening=new Date("2026-11-04T04:30:00.000Z"); // 20:30 PST, same night
    expect(journeySkyMoment(session,evening)).toBe(evening);
    const afterMidnight=new Date("2026-11-04T09:00:00.000Z"); // 01:00 PST, still the Nov 3 observing night
    expect(journeySkyMoment(session,afterMidnight)).toBe(afterMidnight);
    const nextNight=new Date("2026-11-05T04:30:00.000Z");
    expect(journeySkyMoment(session,nextNight).toISOString()).toBe(session.startAt);
  });

  it("hops the whole plan only through items a star hop can reach (no lunar features)",()=>{
    expect(hoppableNightItems([{id:"moon:copernicus"},{id:"M31"},{id:"star:HR2061"}]).map(item=>item.id)).toEqual(["M31","star:HR2061"]);
    expect(hoppableNightItems([{id:"moon:tycho"}])).toEqual([]);
    expect(LINK_LABELS.hopPlan).toBe("Hop the whole plan");
  });
});
