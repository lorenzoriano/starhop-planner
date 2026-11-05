import { describe, expect, it } from "vitest";
import { catalogFocus } from "@/components/CatalogExplorer";
import { catalogPath } from "../navigation";
import type { UnifiedTarget } from "../astronomy";

const target = (id: string, name: string): UnifiedTarget => ({ id, name, displayName: name, aliases: [], mag: 4, ra: 10, dec: 10, con: "Ori", category: "Open Cluster", categoryShort: "Cluster", source: "binocular", desc: "" });
const targets = [target("M42", "Orion Nebula"), target("STAR-Betelgeuse", "Betelgeuse"), target("NGC869", "Double Cluster"), target("NGC2169", "'37' Cluster")];

describe("Catalog object focus (#/catalog?object=…&photos=1)", () => {
  it("focuses the object named in the location", () => {
    expect(catalogFocus(catalogPath("M42"), targets)).toEqual({ target: targets[0], photos: false });
    expect(catalogFocus("/catalog?object=NGC869", targets).target?.id).toBe("NGC869");
  });
  it("shows photos only with photos=1 and a resolvable object", () => {
    expect(catalogFocus(catalogPath("NGC869", { photos: true }), targets)).toEqual({ target: targets[2], photos: true });
    expect(catalogFocus("/catalog?photos=1", targets)).toEqual({ photos: false });
    expect(catalogFocus("/catalog?object=NOPE&photos=1", targets)).toEqual({ photos: false });
  });
  it("matches any id form of the same object", () => {
    expect(catalogFocus("/catalog?object=HR2061", targets).target?.id).toBe("STAR-Betelgeuse");
    expect(catalogFocus("/catalog?object=star:HR2061", targets).target?.id).toBe("STAR-Betelgeuse");
    expect(catalogFocus("/catalog?object=AST-IC37", targets).target?.id).toBe("NGC2169");
  });
  it("is unfocused without an object", () => {
    expect(catalogFocus("/catalog", targets)).toEqual({ photos: false });
    expect(catalogFocus("/catalog?object=HR1", targets)).toEqual({ photos: false });
  });
});
