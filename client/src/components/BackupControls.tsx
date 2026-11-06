import { Suspense, useRef, useState } from "react";
import { Download, Share2, Upload } from "lucide-react";
import { Button } from "./ui/button";
import { canShareFile, downloadFile, shareFile } from "@/lib/file-transfer";
import { SendBackupToPhone } from "./plan-share-entry";
import { applyBackup, createBackup, readBackupFile, readJourneyBackup, writeJourneyBackup, type BackupData, type BackupMode, type BackupPreview } from "@/lib/backup";

type Props = {
  data: BackupData;
  onImport: (next: BackupData, mode: BackupMode) => void;
};

export function BackupControls({ data, onImport }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [mode, setMode] = useState<BackupMode>("merge");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const backupFile = () => {
    // Sky Journeys progress and feedback live in their own device keys; read them at export time.
    const journeys = readJourneyBackup();
    return new File([createBackup(journeys ? { ...data, journeys } : data)], `starhop-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" });
  };
  const download = () => {
    try {
      // Appended link, revoked later (file-transfer.ts): Android Chrome needs both to save the file.
      downloadFile(backupFile());
      setStatus("Backup downloaded."); setError("");
    } catch {
      setError("Could not create the backup file."); setStatus("");
    }
  };
  const fileShareable = (() => { try { return canShareFile(new File(["{}"], "x.json", { type: "application/json" })); } catch { return false; } })();
  const share = async () => {
    try {
      const outcome = await shareFile(backupFile());
      if (outcome === "shared") { setStatus("Backup shared."); setError(""); }
      else if (outcome === "unavailable") { setError("This browser cannot share files. Download the backup instead."); setStatus(""); }
    } catch {
      setError("Could not create the backup file."); setStatus("");
    }
  };

  const selectFile = async (file?: File) => {
    setPreview(null); setError(""); setStatus("");
    if (!file) return;
    try { setPreview(await readBackupFile(file)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read this backup."); }
  };

  const apply = () => {
    if (!preview) return;
    try {
      const journeys = readJourneyBackup();
      const next = applyBackup(journeys ? { ...data, journeys } : data, preview.backup, mode);
      if (!writeJourneyBackup(next.journeys)) throw new Error("Could not save the journey progress from this backup on this device.");
      onImport(next, mode);
      setStatus(mode === "merge" ? "Backup merged." : "Backup restored.");
      setPreview(null); setError("");
      if (input.current) input.current.value = "";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply this backup.");
      setStatus("");
    }
  };

  return <section className="space-y-3" aria-label="Backup and restore">
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={download}><Download size={15}/> Download backup</Button>
      {fileShareable && <Button type="button" variant="outline" onClick={() => void share()}><Share2 size={15}/> Share backup</Button>}
      <Button type="button" variant="outline" onClick={() => input.current?.click()}><Upload size={15}/> Choose backup file</Button>
      <Suspense fallback={null}><SendBackupToPhone data={data}/></Suspense>
      {/* Android file managers often label .json files text/plain or octet-stream; the contents are validated anyway. */}
      <input ref={input} className="sr-only" type="file" accept=".json,application/json,text/plain,application/octet-stream" aria-label="Choose a Starhop backup file" onChange={event => void selectFile(event.target.files?.[0])}/>
    </div>
    <p className="text-sm text-muted-foreground">Move your settings, observing sessions, notes, recorded observations, saved locations and Sky Journeys progress to another device. Backup files can be up to 5 MiB. To move one night from a laptop to your phone, use Send to phone in the Planner’s Export & more menu.</p>
    {preview && <div className="rounded-md border p-3 space-y-3" aria-label="Backup import preview">
      <div><strong>Backup preview</strong><p className="text-sm text-muted-foreground">Exported {new Date(preview.exportedAt).toLocaleString()}</p></div>
      <ul className="text-sm">
        <li>{preview.counts.sessions} sessions</li>
        <li>{preview.counts.targets} distinct targets, including {preview.counts.observations} recorded observations</li>
        <li>{preview.counts.locations} saved locations</li>
        {preview.counts.journeys !== undefined && <li>{preview.counts.journeys} sky journeys and {preview.counts.journeyFeedback ?? 0} journey notes (seen, skipped, ratings)</li>}
        <li>Settings included</li>
      </ul>
      <label className="flex items-start gap-2 text-sm"><input type="radio" name="backup-mode" checked={mode === "merge"} onChange={() => setMode("merge")}/><span><strong>Merge</strong> sessions and locations with this device. Imported settings become active; existing session notes and observations are retained.</span></label>
      <label className="flex items-start gap-2 text-sm"><input type="radio" name="backup-mode" checked={mode === "replace"} onChange={() => setMode("replace")}/><span><strong>Replace</strong> settings, sessions and saved locations on this device with this backup.</span></label>
      <Button type="button" onClick={apply}>Apply {mode === "merge" ? "merge" : "restore"}</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {status && <p role="status" className="text-sm">{status}</p>}
  </section>;
}
