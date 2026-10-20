import { useState } from "react";
import { Moon } from "lucide-react";
import type { UnifiedTarget } from "@/lib/astronomy";
import { CatalogCombobox } from "./CatalogCombobox";

export function MoonTargetPicker({ targets, target, onSelect }: { targets: UnifiedTarget[]; target?: UnifiedTarget; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const choose = (selected: UnifiedTarget) => { onSelect(selected.id); setQuery(""); };
  return <section className="moon-target-picker" id="moon-comparison-target" aria-label="Moon comparison object">
    <div><span className="eyebrow"><Moon size={13}/> COMPARE WITH THE MOON</span><h2>{target?.name ?? "Choose an object"}</h2><p>Shared with Tonight, Binoculars and Star hop. Uses the observing time and location above.</p></div>
    <CatalogCombobox
      className="moon-target-search"
      targets={targets}
      query={query}
      onQuery={setQuery}
      onSelect={choose}
      label="Change comparison object"
      lunarHintAction={<a href="#lunar-landmarks" onClick={event => { event.preventDefault(); document.getElementById("lunar-landmarks")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Browse lunar landmarks</a>}
    />
  </section>;
}
