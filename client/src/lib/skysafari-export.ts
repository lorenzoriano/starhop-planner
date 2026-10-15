import { formatInTimeZone } from "date-fns-tz";
import tzLookup from "tz-lookup";
import type { UnifiedTarget } from "./astronomy";
import { lunarFeatures } from "./moon";
import type { NightItem } from "./session";
import { suggestSequence, type ObservingSession } from "./session-planner";

export const SKYSAFARI_FORMAT_HELP = "https://support.simulationcurriculum.com/hc/en-us/articles/231539467-SkySafari-for-Android-Frequently-Asked-Questions";
export const SKYSAFARI_ANDROID_HELP = "https://support.simulationcurriculum.com/hc/en-us/community/posts/28478507276567-How-To-Copy-Skylist-Files-To-Observing-List-Using-SkySafari-7-On-Android-Answer-Read-On";
export type ExportScope = "list" | "plan";
type Identity = { kind: 1 | 2 | 4; catalog?: string; commonName?: string };
export type SkySafariEntry = Identity & { name: string; itemIds: string[]; comments: string[]; observedAt?: string };
export interface ExportContext {
  items: NightItem[];
  targets: UnifiedTarget[];
  session?: ObservingSession;
  date: Date;
  lat: number;
  lon: number;
  scope: ExportScope;
  skyBrightness: number;
}

const greekNames: Record<string, string> = {
  α:"Alpha", β:"Beta", γ:"Gamma", δ:"Delta", ε:"Epsilon", ζ:"Zeta", η:"Eta", θ:"Theta", ι:"Iota", κ:"Kappa", λ:"Lambda", μ:"Mu", ν:"Nu", ξ:"Xi", ο:"Omicron", π:"Pi", ρ:"Rho", σ:"Sigma", τ:"Tau", υ:"Upsilon", φ:"Phi", χ:"Chi", ψ:"Psi", ω:"Omega",
};
/** One unambiguous identifier: SkySafari requires ALL supplied names to match. */
function catalogIdentifier(value: string, stellar: boolean): string | undefined {
  const clean = value.trim().replace(/[α-ω]/g, letter => greekNames[letter] ?? letter)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, digit => String("⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(digit)));
  const catalog = clean.match(/^(M|NGC|IC|HR|HD|HIP|Cr|Collinder|Mel|Melotte|Stock|Tr|Trumpler)\s*(\d+)$/i);
  if (catalog) {
    const prefix: Record<string,string> = { m:"M", ngc:"NGC", ic:"IC", hr:"HR", hd:"HD", hip:"HIP", cr:"Cr", collinder:"Cr", mel:"Mel", melotte:"Mel", stock:"Stock", tr:"Tr", trumpler:"Tr" };
    return `${prefix[catalog[1].toLowerCase()]} ${Number(catalog[2])}`;
  }
  if (stellar && /^(?:Alpha|Beta|Gamma|Delta|Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi|Omicron|Pi|Rho|Sigma|Tau|Upsilon|Phi|Chi|Psi|Omega)\d*\s+[A-Za-z]{3}$/.test(clean)) return clean;
  if (stellar && /^\d+\s+[A-Za-z]{3}$/.test(clean)) return clean;
  return undefined;
}
export function skySafariIdentity(target: UnifiedTarget): Identity | null {
  const stellar = /star/i.test(target.category) && !/^M\d+$/.test(target.id);
  const identifiers = [target.id.replace(/^star:/,""), ...(target.aliases ?? []).flatMap(alias => alias.split(/\s*\/\s*/))];
  // A Messier identifier can describe a double (M40); prefer its catalog type.
  const messier = identifiers.map(value => catalogIdentifier(value, false)).find(value => value?.startsWith("M "));
  if (messier) return { kind:4, catalog:messier };
  const numbers = identifiers.map(value => catalogIdentifier(value, stellar)).filter((value):value is string => !!value);
  const catalog = (stellar ? numbers.find(value => /^HR /.test(value)) : undefined) ?? numbers[0];
  if (catalog) return { kind:stellar ? 2 : 4, catalog };
  if (target.id === "LMC" || target.id === "SMC") return { kind:4, commonName:target.id === "LMC" ? "Large Magellanic Cloud" : "Small Magellanic Cloud" };
  return null;
}

// The documented format uses literal backslash-n inside Comment, not extra
// physical lines. Escape literal slashes too, and never allow line injection.
export function skySafariValue(value: string): string {
  return value.replace(/\\/g,"\\\\").replace(/\r\n|[\r\n\u2028\u2029]/g,"\\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"");
}
export function skyListText(entries: SkySafariEntry[]): string {
  const lines = ["SkySafariObservingListVersion=3.0"];
  for (const entry of entries) {
    lines.push("SkyObject=BeginObject", `ObjectID=${entry.kind},-1,-1`);
    if (entry.catalog) lines.push(`CatalogNumber=${skySafariValue(entry.catalog)}`);
    else if (entry.commonName) lines.push(`CommonName=${skySafariValue(entry.commonName)}`);
    if (entry.observedAt && Number.isFinite(Date.parse(entry.observedAt))) lines.push(`DateObserved=${(Date.parse(entry.observedAt)/86400000+2440587.5).toFixed(8)}`);
    if (entry.comments.length) lines.push(`Comment=${skySafariValue(entry.comments.join("\n\n"))}`);
    lines.push("EndObject=SkyObject");
  }
  return lines.join("\n")+"\n";
}

export function buildSkySafariExport(context: ExportContext) {
  const { items, targets, session, scope } = context;
  const at = session ? new Date(session.startAt) : context.date;
  const lat = session?.lat ?? context.lat, lon = session?.lon ?? context.lon;
  const zone = tzLookup(lat,lon), title = session?.name ?? "StarHop observing list";
  const stamp = (date:Date) => formatInTimeZone(date,zone,"yyyy-MM-dd HH:mm XXX");
  const site = `${session?.locationName ? session.locationName+" · " : ""}${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
  const sequence = session ? suggestSequence(session,targets,context.skyBrightness) : [];
  const scheduled = sequence.filter(step => step.date);
  const ordered = scope === "plan" ? scheduled.flatMap(step => items.filter(item => item.id === step.id)) : items;
  const targetById = new Map(targets.map(target => [target.id,target]));
  const entries: SkySafariEntry[] = [], notesOnly: { id:string; name:string; reason:string }[] = [];
  const byIdentity = new Map<string,SkySafariEntry>();
  let lunarCount = 0;
  const nameFor = (id:string) => lunarFeatures.find(feature => `moon:${feature.id}` === id)?.name ?? targetById.get(id)?.displayName ?? id;
  for (const [index,item] of Array.from(ordered.entries())) {
    const target = targetById.get(item.id);
    const feature = lunarFeatures.find(feature => `moon:${feature.id}` === item.id);
    const identity: Identity | null = feature ? {kind:1,commonName:"Moon"} : target ? skySafariIdentity(target) : null;
    if (!identity) { notesOnly.push({id:item.id,name:nameFor(item.id),reason:target ? "No standard catalog identifier; kept in the plan notes for manual lookup." : "Catalog entry unavailable; kept in the plan notes."}); continue; }
    const key = `${identity.kind}:${identity.catalog ?? identity.commonName}`;
    let entry = byIdentity.get(key);
    if (!entry) { entry = {...identity,name:feature?"Moon":nameFor(item.id),itemIds:[],comments:[]}; entries.push(entry); byIdentity.set(key,entry); }
    entry.itemIds.push(item.id);
    if (feature) lunarCount++;
    const slot = sequence.find(step => step.id === item.id);
    entry.comments.push([
      `StarHop ${scope === "plan" ? "plan" : "list"} #${index+1}: ${nameFor(item.id)}`,
      `${title} · ${stamp(at)} · ${zone} · Site: ${site}`,
      slot?.date ? `Suggested start: ${stamp(slot.date)} · ${session!.minutesPerTarget} min · ${Math.round(slot.alt)}° high${slot.separation !== null ? ` · ${Math.round(slot.separation)}° from Moon` : ""}` : item.observedAt ? "Previously observed; not rescheduled." : session ? `Not scheduled: ${slot?.reason ?? "no usable slot"}` : "No timed session assigned.",
      ...(feature ? [`Lunar landmark: ${feature.name}. Individual feature records remain in these notes.`] : []),
      ...(target?.binoTip ? [`Observing tip: ${target.binoTip}`] : []),
      item.observedAt ? `Recorded observation: ${item.observedAt}` : "Planned only; no observation recorded.",
      item.notes,
    ].filter(Boolean).join("\n"));
    // Moon landmarks share one planetary entry; never invent an aggregate
    // observation timestamp from individual feature records.
    if (!feature && item.observedAt && (!entry.observedAt || item.observedAt > entry.observedAt)) entry.observedAt = item.observedAt;
  }
  const filenameTitle = title.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60) || "observing-night";
  const basename = `starhop-${filenameTitle.toLowerCase()}-${formatInTimeZone(at,zone,"yyyy-MM-dd")}-${scope}`;
  const lines = [
    `STARHOP — ${title}`, `Start: ${stamp(at)} (${zone})`, `Site: ${site}`,
    ...(session ? [`Session: ${session.durationMinutes} minutes · ${session.minutesPerTarget} minutes per target`] : ["Unscheduled observing list; choose a dated session for timed suggestions."]),
    "", "SKYSAFARI TRANSFER", `${entries.length} SkySafari entries in ${basename}.skylist.`,
    "Importing a list does not set SkySafari's time or location. Set them separately using the values above.",
    "List order and numbered comments follow StarHop. If SkySafari sorts the list, use this plan for the intended viewing order.",
    ...entries.map((entry,index) => `${index+1}. ${entry.name} — ${entry.catalog ?? entry.commonName}`),
    ...(lunarCount ? [`${lunarCount} lunar landmarks grouped into one Moon entry; feature details and records are in comments.`] : []),
    "", "SUGGESTED VIEWING SEQUENCE",
    ...(scheduled.length ? scheduled.map((step,index) => `${index+1}. ${stamp(step.date!)} — ${step.name} · ${session!.minutesPerTarget} min · ${Math.round(step.alt)}° high${step.separation !== null ? ` · ${Math.round(step.separation)}° from Moon` : ""}\n   ${step.reason}`) : ["No timed targets in this session. Completed targets are not scheduled again."]),
    ...sequence.filter(step => !step.date).map(step => `Not scheduled: ${step.name} — ${step.reason}`),
    "", "OBJECTS, OBSERVATIONS AND NOTES — COMPLETE SAVED LIST",
  ];
  for (const item of items) {
    const target = targetById.get(item.id);
    lines.push("", nameFor(item.id), item.observedAt ? `Observed: ${item.observedAt}` : "To observe",
      ...(target ? [`J2000 position: RA ${target.ra.toFixed(5)}° · Dec ${target.dec.toFixed(5)}°`, ...(target.binoTip ? [target.binoTip] : [])] : []), item.notes || "No notes.");
  }
  if (notesOnly.length) lines.push("", "MANUAL LOOKUP — NOT IN SKYSAFARI FILE", ...notesOnly.map(item => `${item.name}: ${item.reason}`));
  lines.push("", "IMPORT ON ANDROID", "Open the .skylist file from Downloads with SkySafari Plus. If your phone does not offer it, email the file to yourself as an attachment, then open that attachment with SkySafari.", "In SkySafari, open Observe > Observing Lists and check the imported list and object count. Your device and SkySafari version determine file-opening support.", "FROM A COMPUTER", "Transfer the .skylist to your phone using USB or an email attachment, keep its extension, and follow the Android steps. Keep this .txt plan for the suggested times, site and full notes.", `SkySafari format help: ${SKYSAFARI_FORMAT_HELP}`, `Android file-import troubleshooting (documented for version 7): ${SKYSAFARI_ANDROID_HELP}`, "", "Times and visibility are calculated suggestions; weather and local obstacles are not measured.");
  return { entries, notesOnly, lunarCount, omittedFromPlan:scope === "plan" ? items.filter(item => !ordered.includes(item)).map(item => ({id:item.id,name:nameFor(item.id),reason:item.observedAt?"Already observed":sequence.find(step=>step.id===item.id)?.reason ?? "No scheduled slot"})) : [],
    skylist:skyListText(entries), planText:lines.join("\n")+"\n", basename, zone, title };
}
