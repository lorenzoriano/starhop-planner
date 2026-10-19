import { useState } from "react";
import { ArrowUpRight, Image as ImageIcon } from "lucide-react";
import { binocularMedia, binocularFeaturedImage, primaryOpticalImage, SURVEY_CREDITS, type SurveyBand } from "@/lib/binocular-media";

export function BinocularPhoto({ id, name }: { id: string; name: string }) {
  const photo=primaryOpticalImage(id);
  return photo ? <img className="binocular-photo" src={`./${photo.path}`} alt={`${photo.title} — ${name}. ${photo.note}`} width={photo.width} height={photo.height} loading="lazy" decoding="async" /> : null;
}

export function BinocularImages({ id, name }: { id: string; name: string }) {
  const portrait = binocularFeaturedImage(id);
  const [band, setBand] = useState<SurveyBand | "featured">(portrait ? "featured" : "optical");
  const media = binocularMedia(id);
  const selected = band === "featured" && portrait ? { path: portrait.path, url: portrait.source } : media?.images.find((image) => image.variant === band);
  if (!media || !selected) return null;
  const fieldWidth = media.fov.toLocaleString("en", { maximumFractionDigits: 1 });
  const credit = band === "featured" && portrait ? { title: portrait.title, credit: `${portrait.credit} · ${portrait.licenseName}`, policy: portrait.licenseUrl, note: portrait.note } : SURVEY_CREDITS[band as SurveyBand];
  const choices = [...(portrait ? [{ variant: "featured" as const, path: portrait.path, title: "Telescope portrait" }] : []), ...media.images.filter(image=>image.display!==false).map((image) => ({ ...image, title: SURVEY_CREDITS[image.variant].title }))];
  return <section className="binocular-image-gallery" aria-label={`Survey images of ${name}`}>
    <div className="binocular-gallery-heading"><span className="eyebrow"><ImageIcon size={13} /> LIGHT FROM THE ARCHIVES</span><span>{band === "featured" ? "Telescope portrait" : `${fieldWidth}° wide · north up`}</span></div>
    <figure>
      <img className="binocular-gallery-photo" src={`./${selected.path}`} width={640} height={480} alt={band === "featured" ? `${credit.title}. ${credit.note}` : `${credit.title} survey image centered on ${name}, ${fieldWidth} degrees wide, north up and east left.`} />
      <figcaption><strong>{credit.title}</strong><a href={selected.url} target="_blank" rel="noreferrer">{band === "featured" ? "Image source" : "Original cutout"} <ArrowUpRight size={12} /></a></figcaption>
    </figure>
    <div className="binocular-image-options" role="group" aria-label="Choose an image">{choices.map((image) => <button key={image.variant} onClick={() => setBand(image.variant)} aria-pressed={band === image.variant} className={band === image.variant ? "active" : ""}>
      <img src={`./${image.path}`} width={80} height={60} alt="" loading="lazy" /><span>{image.title}</span>
    </button>)}</div>
    <p className="binocular-image-explanation">These are telescope survey images, not live images or a prediction of what binoculars reveal. {credit.note}</p>
    <div className="binocular-image-credit"><span>{credit.credit}</span><a href={credit.policy} target="_blank" rel="noreferrer">Credits & use <ArrowUpRight size={10} /></a></div>
    <span className="binocular-image-service">{band === "featured" ? "Photograph via Wikimedia Commons" : "Cutouts provided by CDS HiPS2FITS"} · saved with the app for offline use</span>
  </section>;
}
