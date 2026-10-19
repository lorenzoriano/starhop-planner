import manifest from "./binocular-media.json";
import featured from "./binocular-featured-images.json";
import type { UnifiedTarget } from "./astronomy";

export type SurveyBand = "optical" | "infrared";
export interface SurveyImage { variant: SurveyBand; path: string; url: string; display?:boolean; qualityNote?:string; }
export interface TargetMedia { ra: number; dec: number; fov: number; images: SurveyImage[]; }
const images = manifest as Record<string, TargetMedia>;
export function binocularMedia(targetId: string): TargetMedia | undefined { return images[targetId]; }
interface FeaturedImage { title: string; path: string; source: string; licenseName: string; licenseUrl: string; credit: string; note: string; useAsPrimary?:boolean; shortCredit?:string; width?:number; height?:number; }
export function binocularFeaturedImage(targetId: string): FeaturedImage | undefined { return (featured as Record<string, FeaturedImage>)[targetId]; }
export const SURVEY_CREDITS = {
  optical: { title: "DSS2 · optical", credit: "Digitized Sky Survey · STScI / Caltech / UKST / AAO; color mosaic by CDS", policy: "https://archive.stsci.edu/publishing/data-use", note: "Historical optical survey photographs. Plate seams, glare and saturated stars may be visible. Educational, noncommercial use; survey copyrights retained." },
  infrared: { title: "2MASS · near-infrared", credit: "2MASS / UMass / IPAC-Caltech / NASA / NSF; color mosaic by CDS", policy: "https://www.ipac.caltech.edu/2mass/gallery/aboutimages.html", note: "False-color J/H/K near-infrared mosaic. These wavelengths are invisible to the eye; colors do not represent a binocular view." },
} as const;

/** Resolved identifiers for physical objects; coordinate queries for informal patterns. */
export function binocularDatabaseResources(target: UnifiedTarget, fov: number) {
  const hr: Record<string, number> = { Algol: 936, Mira: 681, Betelgeuse: 2061, Aldebaran: 1457, Arcturus: 5340, Antares: 6134, Rasalgethi: 6406, MuCep: 8316, Capella: 1708, Sirius: 2491, Procyon: 2943, Vega: 7001, Deneb: 7924, Fomalhaut: 8728, Alphard: 3748, LaSuperba: 4846 };
  const doubles: Record<string, string> = { "DS-MizarAlcor": "Mizar", "DS-NuDra": "nu Dra", "DS-AlpCap": "alf01 Cap", "DS-AlpLib": "alf Lib", "DS-DoubleDbl": "eps01 Lyr", "DS-56And": "56 And", "DS-Albireo": "bet Cyg", "DS-ThetaTau": "tet01 Tau", "DS-16Dra": "16 Dra", "DS-39Dra": "39 Dra", "DS-14Ari": "14 Ari", "DS-NuGem": "nu Gem" };
  const id = target.id.startsWith("STAR-") ? `HR ${hr[target.id.slice(5)]}` : doubles[target.id] ?? (/^(M\d+|NGC\d+|IC\d+|Mel\d+|Stock\d+|Tr\d+|Cr\d+)$/.test(target.id) ? target.id.replace(/^(NGC|IC|Mel|Stock|Tr|Cr)/, "$1 ") : target.id === "LMC" || target.id === "SMC" ? target.id : undefined);
  const coordinate = `${target.ra.toFixed(7)} ${target.dec >= 0 ? "+" : ""}${target.dec.toFixed(7)}`;
  return [
    { title: id ? "SIMBAD · object data & bibliography" : "SIMBAD · objects in this star field", url: id ? `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(id)}` : `https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${encodeURIComponent(coordinate)}&Radius=30&Radius.unit=arcmin` },
    { title: "Aladin · explore the survey sky", url: `https://aladin.cds.unistra.fr/AladinLite/?target=${encodeURIComponent(coordinate)}&fov=${fov}&survey=P%2FDSS2%2Fcolor` },
  ];
}

/** One audited optical image and truthful attribution for every discovery surface. */
export function primaryOpticalImage(id:string) {
  const portrait=binocularFeaturedImage(id);
  if(portrait?.useAsPrimary)return {path:portrait.path,url:portrait.source,credit:portrait.credit,shortCredit:portrait.shortCredit??portrait.credit,licenseName:portrait.licenseName,policy:portrait.licenseUrl,note:portrait.note,title:portrait.title,caption:`${portrait.shortCredit??portrait.credit} · ${portrait.licenseName}`,width:portrait.width??640,height:portrait.height??480,kind:'portrait' as const};
  const media=binocularMedia(id),image=media?.images.find(i=>i.variant==='optical'&&i.display!==false);
  if(!media||!image)return undefined;
  return {path:image.path,url:image.url,credit:SURVEY_CREDITS.optical.credit,shortCredit:'DSS2 / CDS',licenseName:'Survey photograph',policy:SURVEY_CREDITS.optical.policy,note:`${media.fov.toFixed(1)}° optical field. Telescope survey exposure; binoculars show less detail and color.`,title:'DSS2 optical survey photograph',caption:'DSS2 · OPTICAL SURVEY',width:640,height:480,kind:'survey' as const};
}
export const opticalPhotoCaption=(id:string)=>primaryOpticalImage(id)?.caption??'Optical photograph';
