import { useEffect, useMemo, useState } from "react";
import { Download, Share2, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { buildSkySafariExport, SKYSAFARI_ANDROID_HELP, SKYSAFARI_FORMAT_HELP, type ExportContext, type ExportScope } from "@/lib/skysafari-export";
import { canShareFile, downloadFile, shareFile } from "@/lib/file-transfer";

export function SkySafariExport(context: Omit<ExportContext,"scope">) {
  const [open,setOpen] = useState(false);
  const [scope,setScope] = useState<ExportScope>("list");
  const [sharing,setSharing] = useState(false);
  const [message,setMessage] = useState("");
  const output = useMemo(() => open ? buildSkySafariExport({...context,scope}) : null,
    [open,scope,context.items,context.targets,context.session,context.date,context.lat,context.lon,context.skyBrightness]);
  const listFile = useMemo(() => output ? new File([output.skylist],`${output.basename}.skylist`,{type:"text/plain"}) : null,[output]);
  const planFile = useMemo(() => output ? new File([output.planText],`${output.basename}-notes.txt`,{type:"text/plain"}) : null,[output]);
  const shareSupported = listFile ? canShareFile(listFile) : false;
  useEffect(() => { setMessage(""); },[open,scope]);
  useEffect(() => { if (!context.session && scope === "plan") setScope("list"); },[context.session,scope]);
  const share = async () => {
    if (!listFile) return;
    setSharing(true);setMessage("");
    const result = await shareFile(listFile);
    if (result === "shared") setMessage("File handed to your device. Complete the import in SkySafari, then check the list.");
    if (result === "unavailable") setMessage("This device could not share the file. Download the list below, then open it from Files or an email attachment.");
    setSharing(false);
  };
  return <>
    <Button variant="outline" onClick={() => setOpen(true)} data-testid="button-export-skysafari"><Share2 size={15}/> Export to SkySafari</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="skysafari-export-dialog">
        <DialogHeader><DialogTitle>Take your night to SkySafari</DialogTitle><DialogDescription>Export a list for SkySafari 8 Plus, with a separate plan for your times, site and notes.</DialogDescription></DialogHeader>
        <div className="skysafari-scope" aria-label="Export selection">
          <button aria-pressed={scope === "list"} onClick={() => setScope("list")}><strong>Observing list</strong><span>All saved targets, including recorded observations.</span></button>
          <button aria-pressed={scope === "plan"} disabled={!context.session} onClick={() => setScope("plan")}><strong>Night plan</strong><span>{context.session ? "Scheduled targets in the suggested viewing order." : "Create a dated session in Planner first."}</span></button>
        </div>
        {output && <>
          <section className="skysafari-preview" aria-label="Export preview">
            <p className="eyebrow">{output.title}</p>
            <h3>{output.entries.length} SkySafari {output.entries.length === 1 ? "entry" : "entries"}</h3>
            <p>{scope === "plan" ? "Already observed targets and targets without a usable slot stay in the notes file." : "Recorded dates are actual observations. Suggested times are kept in comments."}</p>
            <ul>{output.entries.slice(0,6).map((entry,index) => <li key={index}><span>{entry.name}</span><small>{entry.catalog ?? entry.commonName}</small></li>)}</ul>
            {output.entries.length > 6 && <p>And {output.entries.length-6} more.</p>}
            {output.lunarCount > 0 && <p>{output.lunarCount} lunar {output.lunarCount === 1 ? "landmark is" : "landmarks are"} grouped under one Moon entry. Feature names, times and records remain in comments and plan notes.</p>}
            {output.notesOnly.length > 0 && <details className="skysafari-exclusions"><summary>{output.notesOnly.length} {output.notesOnly.length === 1 ? "target needs" : "targets need"} manual lookup · kept in notes</summary><ul>{output.notesOnly.map(item => <li key={item.id}><strong>{item.name}</strong><span>{item.reason}</span></li>)}</ul></details>}
            {output.omittedFromPlan.length > 0 && <details className="skysafari-exclusions"><summary>{output.omittedFromPlan.length} saved {output.omittedFromPlan.length === 1 ? "target outside" : "targets outside"} this plan</summary><ul>{output.omittedFromPlan.map(item => <li key={item.id}><strong>{item.name}</strong><span>{item.reason}</span></li>)}</ul></details>}
            {!context.items.length && <p>Add objects to your session or observing list in Planner to export them.</p>}
            {!output.entries.length && !!context.items.length && <p>No importable targets in this selection. The notes file still includes your complete list.</p>}
          </section>
          <div className="skysafari-export-actions">
            {shareSupported && <Button onClick={share} disabled={sharing || !output.entries.length}><Share2 size={15}/>{sharing ? "Opening share sheet…" : "Share .skylist"}</Button>}
            <Button variant={shareSupported ? "outline" : "default"} disabled={!output.entries.length} onClick={() => { if (listFile) downloadFile(listFile); }}><Download size={15}/> Download .skylist</Button>
            <Button variant="outline" disabled={!context.items.length} onClick={() => { if (planFile) downloadFile(planFile); }}><Download size={15}/> Download plan notes</Button>
          </div>
          {message && <p className="skysafari-transfer-status" role="status">{message}</p>}
          <p className="skysafari-file-note">The .skylist transfers catalog targets. The .txt plan keeps the full viewing sequence, observations and notes, including objects that need manual lookup. Import does not change SkySafari’s time or location.</p>
        </>}
        <section className="skysafari-import-help" aria-label="SkySafari import instructions">
          <h3>Import on your Android phone</h3>
          <ol>
            <li>Use <strong>Share .skylist</strong> if offered, and choose SkySafari Plus if it appears. Otherwise use <strong>Download .skylist</strong>.</li>
            <li>In your phone’s <strong>Files → Downloads</strong>, open the .skylist file and choose <strong>SkySafari 8 Plus</strong>. If Android does not offer it, email the file to yourself as an attachment, then open or long-press that attachment and choose SkySafari.</li>
            <li>In SkySafari, open <strong>Observe → Observing Lists</strong>. Check the imported list and target count. Set its observing time and location from the plan notes; use the numbered comments or notes file if SkySafari sorts the targets.</li>
          </ol>
          <details><summary>Exporting from a computer</summary><ol><li>Download the .skylist and the plan notes.</li><li>Transfer the .skylist to your Android phone by USB or an email attachment. Keep the .skylist extension.</li><li>Open the file on your phone using the Android steps above. Keep the .txt plan alongside it for the viewing times and full notes.</li></ol></details>
          <details><summary>SkySafari is not offered when opening the file</summary><p>File handling depends on Android, the browser, email app and installed SkySafari version. Try opening an email attachment rather than its preview. If that still fails, consult SkySafari’s built-in Help for file import. Its support team documents a USB import through the app’s files/Observing Lists folder for version 7; confirm the folder for your installed version rather than using an old SD-card path.</p><a href={SKYSAFARI_ANDROID_HELP} target="_blank" rel="noreferrer">Android import troubleshooting (version 7) <ExternalLink size={12}/></a></details>
          <a href={SKYSAFARI_FORMAT_HELP} target="_blank" rel="noreferrer">SkySafari’s documented list format <ExternalLink size={12}/></a>
        </section>
      </DialogContent>
    </Dialog>
  </>;
}
