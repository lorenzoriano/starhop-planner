/**
 * "Send to phone" (laptop side: link + QR code) and the import preview (phone side). Loaded lazily through
 * plan-share-entry.ts; the formats and merge rules live in lib/plan-share.ts.
 */
import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Copy, Download, Share2, Smartphone } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { createBackup, readJourneyBackup, writeJourneyBackup, type BackupData } from "@/lib/backup";
import { canShareFile, downloadFile, shareFile } from "@/lib/file-transfer";
import { readJourneyStore } from "@/lib/journeys/progress";
import { clearPendingImport, PENDING_IMPORT_EVENT, readPendingImport } from "@/lib/import-arrival";
import type { Settings } from "@/lib/session";
import type { ObservingSession } from "@/lib/session-planner";
import type { SavedLocation } from "@/lib/saved-locations";
import {
  applyShareImport, buildShareLink, instrumentLabel, journeyTitleFrom, matchingNight, nightSummary, planShareData, readShareHash,
  referencedJourneys, sameInstrument, shareBase, type ShareKind, type ShareMode, type SharePayload,
} from "@/lib/plan-share";
import "./PlanShare.css";

/** QR code as an SVG: dark modules on its own light tile with the 4-module quiet zone, so it scans on any background. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "L");
    qr.addData(text, "Byte");
    qr.make();
    const n = qr.getModuleCount(), quiet = 4;
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        let run = 1;
        while (c + run < n && qr.isDark(r, c + run)) run++;
        d += `M${c + quiet} ${r + quiet}h${run}v1h-${run}z`;
        c += run - 1;
      }
    }
    return { size: n + 2 * quiet, path: d };
  }, [text]);
  // Whole CSS pixels per module (2–4): uneven module widths make dense codes harder to read off a screen.
  const px = size * Math.max(2, Math.min(4, Math.floor(360 / size)));
  return <svg className="plan-share-qr" viewBox={`0 0 ${size} ${size}`} width={px} height={px} role="img" aria-label={label} shapeRendering="crispEdges" data-testid="plan-share-qr">
    <rect width={size} height={size} fill="#ffffff"/>
    <path d={path} fill="#000000"/>
  </svg>;
}

const fileName = () => `starhop-backup-${new Date().toISOString().slice(0, 10)}.json`;

/** The link, its QR code (when it fits), Copy / Share, and the backup file as the fallback. */
function SendToPhoneDialog({ open, onOpenChange, kind, data, heading }: { open: boolean; onOpenChange: (open: boolean) => void; kind: ShareKind; data: BackupData; heading: string }) {
  const result = useMemo(() => (open ? buildShareLink(shareBase(), kind, data) : null), [open, kind, data]);
  const [status, setStatus] = useState("");
  useEffect(() => { if (open) setStatus(""); }, [open]);
  const canShareLink = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.link); setStatus("Link copied. Paste it into a message to yourself and open it on your phone."); }
    catch { setStatus("Could not copy automatically: select the link below and copy it."); }
  };
  const shareLinkNow = async () => {
    if (!result) return;
    try { await navigator.share({ title: `StarHop: ${heading}`, url: result.link }); setStatus("Link shared."); }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setStatus("Could not share the link. Copy it instead."); }
  };
  const backupFile = () => new File([createBackup(data)], fileName(), { type: "application/json" });
  const shareBackupFile = async () => {
    const outcome = await shareFile(backupFile());
    setStatus(outcome === "shared" ? "Backup file shared." : outcome === "cancelled" ? "" : "This browser cannot share files. Download the backup instead.");
  };
  const downloadBackupFile = () => { downloadFile(backupFile()); setStatus("Backup file downloaded. On the phone: Planner → Backup → Choose backup file."); };
  const fileShareable = useMemo(() => open && canShareFile(new File(["{}"], "x.json", { type: "application/json" })), [open]);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="plan-share-dialog">
      <DialogHeader>
        <DialogTitle>Send to phone</DialogTitle>
        <DialogDescription>{heading}</DialogDescription>
      </DialogHeader>
      {result && <>
        {result.fitsQr
          ? <><QrCode text={result.link} label={`QR code for ${heading}`}/>
            <p className="plan-share-hint">Scan with the phone’s camera and open the link. The installed StarHop app (or Chrome) shows what will be imported before anything changes.</p></>
          : <p className="plan-share-hint" role="note">This is too much for a QR code ({result.chars.toLocaleString()} characters). Send the link by message, or send the backup file and open it on the phone from Planner → Backup → Choose backup file.</p>}
        {kind === "plan" && result.fitsQr && !result.includesJourneys && data.journeys && <p className="plan-share-hint">The journey stories stay on this device to keep the code small; the stops keep their journey and times.</p>}
        <div className="plan-share-actions">
          <Button type="button" variant="outline" onClick={() => void copy()}><Copy size={15}/> Copy link</Button>
          {canShareLink && <Button type="button" variant="outline" onClick={() => void shareLinkNow()}><Share2 size={15}/> Share link</Button>}
          {fileShareable && <Button type="button" variant="outline" onClick={() => void shareBackupFile()}><Share2 size={15}/> Share backup file</Button>}
          <Button type="button" variant="outline" onClick={downloadBackupFile}><Download size={15}/> Download backup file</Button>
        </div>
        <label className="plan-share-link">Link <span>({result.chars.toLocaleString()} characters)</span>
          <input readOnly value={result.link} aria-label="Plan link" data-testid="plan-share-link" onFocus={(event) => event.currentTarget.select()}/>
        </label>
      </>}
      {status && <p role="status" className="plan-share-hint">{status}</p>}
    </DialogContent>
  </Dialog>;
}

/** Planner (per night): send the saved night, its site, your instrument and its journeys to another device. */
export function SendPlanToPhone({ session, settings, savedLocations }: { session?: ObservingSession; settings: Settings; savedLocations: SavedLocation[] }) {
  const [open, setOpen] = useState(false);
  const data = useMemo(() => (session && open ? planShareData({ session, settings, savedLocations, journeys: referencedJourneys(session, readJourneyStore()) }) : null), [session, settings, savedLocations, open]);
  const heading = session ? (() => { const s = nightSummary(session, savedLocations); return `${s.when} · ${s.site} · ${s.objects} ${s.objects === 1 ? "object" : "objects"}`; })() : "";
  return <>
    <Button type="button" variant="outline" disabled={!session} title={session ? undefined : "Create this night first"} onClick={() => setOpen(true)}><Smartphone size={15}/> Send to phone</Button>
    {data && <SendToPhoneDialog open={open} onOpenChange={setOpen} kind="plan" data={data} heading={heading}/>}
  </>;
}

/** Backup controls: send everything (when it fits a QR code; else the backup file). */
export function SendBackupToPhone({ data }: { data: BackupData }) {
  const [open, setOpen] = useState(false);
  const full = useMemo(() => { if (!open) return null; const journeys = readJourneyBackup(); return journeys ? { ...data, journeys } : data; }, [data, open]);
  return <>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}><Smartphone size={15}/> Send everything to phone</Button>
    {full && <SendToPhoneDialog open={open} onOpenChange={setOpen} kind="all" data={full} heading={`Everything: ${full.planner.sessions.length} nights, ${full.savedLocations.length} saved locations, settings`}/>}
  </>;
}

/**
 * Phone side: the preview of a pending import link (import-arrival.ts) with Add / Replace / Cancel. Nothing changes
 * until the user chooses; afterwards the Planner opens on the imported night.
 */
export function PlanImportGate({ data, onImport }: { data: BackupData; onImport: (next: BackupData, focus: ObservingSession | null) => void }) {
  const { toast } = useToast();
  const [hash, setHash] = useState(() => readPendingImport());
  // A second link opened while this one is showing replaces it.
  useEffect(() => {
    const sync = () => setHash(readPendingImport());
    window.addEventListener(PENDING_IMPORT_EVENT, sync);
    return () => window.removeEventListener(PENDING_IMPORT_EVENT, sync);
  }, []);
  const decoded = useMemo((): { payload: SharePayload } | { error: string } | null => {
    if (!hash) return null;
    try { return { payload: readShareHash(hash) }; }
    catch (error) { return { error: error instanceof Error ? error.message : "This link could not be read." }; }
  }, [hash]);
  const [useInstrument, setUseInstrument] = useState(true);
  const [error, setError] = useState("");
  const close = () => clearPendingImport();
  if (!decoded) return null;
  if ("error" in decoded) {
    return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="plan-share-dialog">
        <DialogHeader><DialogTitle>Could not import this link</DialogTitle><DialogDescription>{decoded.error}</DialogDescription></DialogHeader>
        <div className="plan-share-actions"><Button type="button" onClick={close}>Close</Button></div>
      </DialogContent>
    </Dialog>;
  }
  const { payload } = decoded;
  const incoming = payload.preview.backup;
  const plan = payload.kind === "plan";
  const deviceJourneys = readJourneyStore();
  const nights = incoming.planner.sessions.map((s) => nightSummary(s, [...incoming.savedLocations, ...data.savedLocations]));
  const existing = plan ? incoming.planner.sessions.map((s) => matchingNight(data.planner.sessions, s)).filter((s): s is ObservingSession => !!s) : [];
  const instrumentDiffers = plan && !sameInstrument(incoming.settings, data.settings);
  const apply = (mode: ShareMode) => {
    try {
      const journeys = readJourneyBackup();
      const { next, focus } = applyShareImport(journeys ? { ...data, journeys } : data, payload, mode, { useInstrument: instrumentDiffers && useInstrument });
      if (!writeJourneyBackup(next.journeys)) throw new Error("Could not save the journeys from this link on this device.");
      onImport(next, focus);
      close();
      toast({ title: plan ? "Plan imported" : mode === "add" ? "Backup merged" : "Backup restored", description: focus ? nightSummary(focus, next.savedLocations).when + ` · ${focus.items.length} objects` : undefined });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import this link.");
    }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="plan-share-dialog" aria-label="Import preview">
      <DialogHeader>
        <DialogTitle>{plan ? "Import this plan?" : "Import this backup?"}</DialogTitle>
        <DialogDescription>Sent {new Date(payload.preview.exportedAt).toLocaleString()}. Nothing changes until you choose.</DialogDescription>
      </DialogHeader>
      {plan ? <ul className="plan-share-nights" data-testid="plan-import-preview">
        {nights.map((n) => {
          const titles = n.journeyKeys.map((key) => journeyTitleFrom(key, incoming.journeys?.progress, deviceJourneys) ?? payload.journeyTitles?.[key]);
          const named = titles.filter((t): t is string => !!t);
          return <li key={n.id}><strong>{n.when} · {n.site} · {n.objects} {n.objects === 1 ? "object" : "objects"}</strong>
            {n.journeyKeys.length > 0 && <span>{named.length ? ` · from journey ${named.map((t) => `“${t}”`).join(", ")}` : ` · includes stops from ${n.journeyKeys.length} ${n.journeyKeys.length === 1 ? "journey" : "journeys"}`}</span>}</li>;
        })}
      </ul> : <ul className="plan-share-nights" data-testid="plan-import-preview">
        <li>{payload.preview.counts.sessions} nights · {payload.preview.counts.targets} distinct targets · {payload.preview.counts.observations} recorded observations</li>
        <li>{payload.preview.counts.locations} saved locations{payload.preview.counts.journeys !== undefined ? ` · ${payload.preview.counts.journeys} sky journeys` : ""} · settings</li>
      </ul>}
      {instrumentDiffers && <label className="plan-share-check"><input type="checkbox" checked={useInstrument} onChange={(event) => setUseInstrument(event.target.checked)}/>
        <span>Also use the sender’s instrument: {instrumentLabel(incoming.settings)} (this device: {instrumentLabel(data.settings)})</span></label>}
      <p className="plan-share-hint">{plan
        ? existing.length
          ? `You already have “${existing[0].name}” for this night. Add merges into it and keeps your notes and observations; Replace swaps it for this plan.`
          : "Add creates this night in your Planner."
        : "Merge combines nights and locations and makes these settings current. Replace swaps everything on this device for this backup."}</p>
      <div className="plan-share-actions">
        <Button type="button" onClick={() => apply("add")}>{plan ? (existing.length ? "Add to my night" : "Add to Planner") : "Merge"}</Button>
        {(!plan || existing.length > 0) && <Button type="button" variant="outline" onClick={() => apply("replace")}>{plan ? "Replace my night" : "Replace everything"}</Button>}
        <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>;
}
