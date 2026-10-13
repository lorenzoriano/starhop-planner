import { ArrowUpRight, Eye } from "lucide-react";
import observations from "@/lib/binocular-observation-references.json";

interface Reference { title: string; url: string; detail: string; }
export function BinocularObservations({ id }: { id: string }) {
  const references = (observations as Record<string, Reference[]>)[id];
  if (!references) return null;
  return <section className="binocular-observer-views" aria-label="Real binocular observing sketches">
    <h3><Eye size={14} /> Through real binoculars</h3>
    <p>Compare the field with observers’ sketches. Check their binocular size and sky conditions alongside the image.</p>
    {references.map((ref) => <a key={ref.url} href={ref.url} target="_blank" rel="noreferrer"><span>{ref.title}<small>{ref.detail}</small></span><ArrowUpRight size={14} /></a>)}
  </section>;
}
