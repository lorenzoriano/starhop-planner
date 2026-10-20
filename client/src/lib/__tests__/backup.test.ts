import { describe, expect, it } from "vitest";
import { applyBackup, BACKUP_MAX_BYTES, createBackup, parseBackupText, readBackupFile, type BackupData } from "../backup";
import { defaultSettings } from "../session";
import { emptyPlanner } from "../session-planner";

const session = (id: string, items: BackupData["planner"]["sessions"][number]["items"] = []) => ({
  id, name: `Night ${id}`, startAt: "2026-06-01T20:00:00.000Z", lat: 40, lon: -70,
  locationName: "", durationMinutes: 180, minutesPerTarget: 15, items,
  archived: false, createdAt: "2026-05-01T10:00:00.000Z",
});
const observation = (notes: string, observedAt?: string) => ({
  id: "M31", addedAt: "2026-05-01T10:00:00.000Z", ...(observedAt ? { observedAt } : {}), notes,
});
const backup = (sessions: BackupData["planner"]["sessions"] = []): BackupData => ({
  settings: defaultSettings, planner: { ...emptyPlanner, sessions, activeId: sessions[0]?.id ?? null }, savedLocations: [],
});

describe("Starhop backups", () => {
  it("round trips versioned data and previews session, target, observation, and location counts", () => {
    const source = backup([session("a", [observation("faint oval", "2026-06-02T02:00:00.000Z")])]);
    source.savedLocations = [{ id: "site", name: "Back garden", lat: 40, lon: -70 }];
    const parsed = parseBackupText(createBackup(source, new Date("2026-06-03T12:00:00.000Z")));
    expect(parsed.backup).toEqual(source);
    expect(parsed.counts).toEqual({ sessions: 1, targets: 1, observations: 1, locations: 1 });
    expect(parsed.exportedAt).toBe("2026-06-03T12:00:00.000Z");
  });

  it("rejects unsupported versions, malformed schemas, invalid JSON, and oversized files", async () => {
    const valid = JSON.parse(createBackup(backup()));
    expect(() => parseBackupText(JSON.stringify({ ...valid, version: 2 }))).toThrow(/supported Starhop backup/);
    expect(() => parseBackupText(JSON.stringify({ ...valid, data: { ...valid.data, savedLocations: [{ id: "x", name: "", lat: 100, lon: 0 }] } }))).toThrow(/invalid data/);
    expect(() => parseBackupText("{" )).toThrow(/valid JSON/);
    const tooLarge = { size: BACKUP_MAX_BYTES + 1, text: async () => "{}" };
    await expect(readBackupFile(tooLarge)).rejects.toThrow(/larger than 5 MiB/);
    expect(() => parseBackupText(" ".repeat(BACKUP_MAX_BYTES + 1))).toThrow(/larger than 5 MiB/);
  });

  it("merges sessions without dropping notes, observation dates, other sessions, or locations", () => {
    const current = backup([
      session("same", [observation("first note", "2026-06-02T02:00:00.000Z")]),
      session("local", [observation("local-only")]),
    ]);
    current.savedLocations = [{ id: "home", name: "Home", lat: 40, lon: -70 }];
    const incoming = backup([
      session("same", [observation("second note", "2026-06-03T02:00:00.000Z")]),
      session("imported", [observation("imported-only")]),
    ]);
    incoming.savedLocations = [{ id: "away", name: "Dark site", lat: 41, lon: -71 }];

    const result = applyBackup(current, incoming, "merge");
    expect(result.planner.sessions.map(value => value.id)).toEqual(["same", "local", "imported"]);
    expect(result.planner.sessions[0].items[0]).toMatchObject({
      notes: "first note\n\nsecond note", observedAt: "2026-06-03T02:00:00.000Z",
    });
    expect(result.planner.sessions[1].items[0].notes).toBe("local-only");
    expect(result.savedLocations.map(value => value.name)).toEqual(["Home", "Dark site"]);
    expect(result.planner.activeId).toBe("same");
  });

  it("preserves multiple dated entries when merging overlapping session backups",()=>{
    const one={...observation("first"),observedAt:"2026-06-02T02:00:00.000Z",observations:[{at:"2026-06-02T02:00:00.000Z",notes:"first"}]};
    const two={...observation("second"),observedAt:"2026-06-03T02:00:00.000Z",observations:[{at:"2026-06-03T02:00:00.000Z",notes:"second"}]};
    const result=applyBackup(backup([session("same",[one])]),backup([session("same",[two])]),"merge");
    expect(result.planner.sessions[0].items[0].observations?.map(entry=>entry.notes)).toEqual(["first","second"]);
    expect(parseBackupText(createBackup(result)).counts.observations).toBe(2);
  });
  it("replace mode restores imported data exactly", () => {
    const current = backup([session("local")]);
    const incoming = backup([session("cloud")]);
    expect(applyBackup(current, incoming, "replace")).toEqual(incoming);
  });
});
