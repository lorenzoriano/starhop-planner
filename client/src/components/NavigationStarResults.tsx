import { Check, Plus, Star } from "lucide-react";
import { altitudeLabel, compassLabel } from "@/lib/observing";
import type { Star as CatalogStar } from "@/lib/astronomy";
export type NavigationStarHit = { star: CatalogStar; name: string; alt: number; az: number; score: number };
export function NavigationStarResults({ hits, savedIds, onInspect, onSave }: {
  hits: NavigationStarHit[]; savedIds: Set<string>; onInspect: (star: CatalogStar) => void; onSave: (id: string) => void;
}) {
  return <section className="navigation-star-results" aria-label="Catalog navigation stars">
    <p className="eyebrow">CATALOG STARS · INSPECT OR ADD TO YOUR SESSION</p>
    <div className="navigation-star-grid">{hits.map(({star,name,alt,az}) => <article className="navigation-star-row" key={star.id}>
      <button className="navigation-star-main" aria-label={`Inspect ${name}`} onClick={() => onInspect(star)}>
        <Star size={17}/><span><strong>{name}</strong><small>{star.id} · mag {star.mag.toFixed(1)} · {Math.round(alt)}° {compassLabel(az)} · {altitudeLabel(alt)}</small></span>
      </button>
      <button className="icon-button" aria-label={`${savedIds.has(`star:${star.id}`) ? "Remove" : "Add"} ${name} ${savedIds.has(`star:${star.id}`) ? "from" : "to"} session`} onClick={() => onSave(`star:${star.id}`)}>{savedIds.has(`star:${star.id}`) ? <Check size={16}/> : <Plus size={16}/>}</button>
    </article>)}</div>
  </section>;
}
