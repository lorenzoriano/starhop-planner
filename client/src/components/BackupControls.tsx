import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "./ui/button";
import { applyBackup, createBackup, readBackupFile, type BackupData, type BackupMode, type BackupPreview } from "@/lib/backup";

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

  const download = () => {
    try {
      const blob = new Blob([createBackup(data)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `starhop-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("Backup downloaded."); setError("");
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
      const next = applyBackup(data, preview.backup, mode);
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
      <Button type="button" variant="outline" onClick={() => input.current?.click()}><Upload size={15}/> Choose backup file</Button>
      <input ref={input} className="sr-only" type="file" accept=".json,application/json" aria-label="Choose a Starhop backup file" onChange={event => void selectFile(event.target.files?.[0])}/>
    </div>
    <p className="text-sm text-muted-foreground">Move your settings, observing sessions, notes, recorded observations and saved locations to another device. Backup files can be up to 5 MiB.</p>
    {preview && <div className="rounded-md border p-3 space-y-3" aria-label="Backup import preview">
      <div><strong>Backup preview</strong><p className="text-sm text-muted-foreground">Exported {new Date(preview.exportedAt).toLocaleString()}</p></div>
      <ul className="text-sm">
        <li>{preview.counts.sessions} sessions</li>
        <li>{preview.counts.targets} distinct targets, including {preview.counts.observations} recorded observations</li>
        <li>{preview.counts.locations} saved locations</li>
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
