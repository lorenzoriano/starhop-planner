import { fromZonedTime } from "date-fns-tz";
import { eqToHorizontal, type UnifiedTarget } from "./astronomy";
import expandedEntries from "./binocular-guide-extra.json";

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export type BinocularFamily = "star" | "asterism" | "double" | "cluster" | "nebula" | "galaxy";
export type BinocularLevel = "easy" | "dark" | "steady" | "challenge" | "large";
export const FAMILY_LABELS: Record<BinocularFamily, string> = {
  star: "Stars & variables", asterism: "Asterisms & fields", double: "Double stars",
  cluster: "Star clusters", nebula: "Nebulae", galaxy: "Galaxies",
};
export const LEVEL_LABELS: Record<BinocularLevel, string> = {
  easy: "Handheld favorite", dark: "Dark sky helps", steady: "Steady support", challenge: "Dark-sky challenge", large: "Large binoculars",
};
export interface GuideReference { title: string; url: string; kind: "book-index" | "author-guide" | "reference"; }
export interface BinocularEntry {
  targetId: string; family: BinocularFamily; level: BinocularLevel;
  equipment: string; impression: string; finding: string; references: GuideReference[];
  name?: string; variable?: boolean;
  minAperture?: number;
}
export const OMEARA_INDEX = "https://assets.cambridge.org/97805217/21707/index/9780521721707_index.pdf";
const index = (pages: string): GuideReference => ({ title: `O’Meara · pp. ${pages} (publisher index)`, url: OMEARA_INDEX, kind: "book-index" });
const sky = (id: string): GuideReference => ({ title: "Stephen Tonkin · BinocularSky observing guide", url: `https://binocularsky.com/binoc_object_file.php?aperture=100&object_id=${id}`, kind: "author-guide" });
const article = (title: string, url: string): GuideReference => ({ title, url, kind: "author-guide" });
const winter = article("Tonkin · February binocular observing list", "https://binocularsky.com/newsletter/archive/202102.pdf");
const spring = article("Tonkin · May binocular observing list", "https://binocularsky.com/newsletter/archive/201405.pdf");
const hercules = article("Harrington · Hercules binocular observing tour", "https://www.cloudynights.com/articles/column/binocular-universe/binocular-universe-hero-of-song-and-story-r2703/");
const andromeda = article("Harrington · Andromeda binocular observing tour", "https://www.cloudynights.com/articles/column/binocular-universe/binocular-universe-next-stop-andromeda-r2743/");
const entry = (targetId: string, family: BinocularFamily, level: BinocularLevel, equipment: string, impression: string, finding: string, pages?: string, refs: GuideReference[] = []): BinocularEntry => ({
  targetId, family, level, equipment, impression, finding, references: [...(pages ? [index(pages)] : []), ...refs],
});

// Original observing notes. Book-index references confirm coverage, not verbatim advice.
export const BINOCULAR_ENTRIES: BinocularEntry[] = [
  { ...entry("STAR-Algol", "star", "easy", "7×35 / 10×50", "Return on different nights and compare its brightness with nearby stars. Its eclipses make this a rewarding long-term acquaintance.", "Find Perseus below Cassiopeia; Algol is southwest of Mirfak.", "116"), variable: true },
  { ...entry("STAR-Mira", "star", "challenge", "10×50; bright phase matters", "A star that can fade beyond small binoculars. Record what you see; this guide does not predict its current brightness.", "Locate the marked field in Cetus. Revisit it over several weeks rather than expecting a fixed brightness.", "108", [sky("oCet")]), variable: true },
  { ...entry("STAR-Betelgeuse", "star", "easy", "7×35 / 10×50", "Compare Orion’s warm-colored shoulder with its cooler surrounding stars. Brightness varies; color is the main attraction here.", "Begin with Orion’s Belt, then move toward the bright northeastern shoulder.", "123"), variable: true },
  entry("STAR-Aldebaran", "star", "easy", "7×35 / 10×50", "A warm-colored foreground star set against the Hyades. Enjoy the contrast without mistaking it for a cluster member.", "Follow Orion’s Belt toward Taurus and the V-shaped Hyades.", "110"),
  entry("STAR-Arcturus", "star", "easy", "7×35 / 10×50", "A bright orange landmark that makes an easy first stop before hunting fainter spring fields.", "Continue the curve of the Big Dipper’s handle toward the brightest star in Boötes.", "40, 48"),
  { ...entry("STAR-Antares", "star", "easy", "7×35 / 10×50", "Scorpius’s warm-colored heart is a fine color study. Its close companion is a telescope target, not a handheld binocular split.", "Find the bright red star near the head of Scorpius; an open southern horizon helps.", "48, 53–54"), variable: true },
  { ...entry("STAR-Rasalgethi", "star", "easy", "7×35 / 10×50", "Enjoy its reddish tint. The close binary is beyond ordinary binoculars; the changing primary is the binocular target.", "Locate Hercules between Arcturus and Vega, then follow its southern stars.", "51", [hercules]), variable: true },
  { ...entry("STAR-MuCep", "star", "easy", "10×50", "Herschel’s Garnet Star offers a distinctly warm tone. Compare it with neighboring stars and note changes over time.", "Find the southern edge of Cepheus, north of Cygnus.", "88", [winter]), variable: true },

  entry("AST-Coathanger", "asterism", "easy", "7×35 / 10×50; wide field", "A chance alignment makes a delightful hanger shape. A wide field shows the whole pattern at once.", "Sweep between Altair and Albireo, using the finder chart to identify the straight bar.", "80", [article("Harrington · The Coathanger", "https://www.cloudynights.com/articles/cat/column/binocular-universe/binocular-universe-the-coathanger-r1954/")]),
  entry("AST-KemblesCascade", "asterism", "dark", "10×50; wide field", "A long trail of faint stars leads toward a compact cluster. Follow the chain rather than expecting bright nebulosity.", "Use Cassiopeia’s W to get your bearings, then match the field in Camelopardalis.", undefined, [winter]),
  entry("AST-JobsCoffin", "asterism", "easy", "7×35 / 10×50", "The little diamond in Delphinus is a pleasing pattern to frame and compare with the surrounding field.", "Look east of Altair for Delphinus’s compact diamond.", "77–78"),
  entry("AST-EngagementRing", "asterism", "steady", "Supported 10×50", "Polaris sits beside a loop of much fainter stars. Support the binoculars to trace the ring without losing the field.", "Find Polaris with the Big Dipper’s pointer stars, then inspect its immediate surroundings.", "47, 78"),
  entry("AST-OrionBelt", "asterism", "easy", "7×35 / 10×50; wide field", "The familiar Belt becomes a rich stellar neighborhood in binoculars. Take time to trace the faint curves between its bright stars.", "Center the middle Belt star and keep all three Belt stars within the field.", "123", [sky("Cr70")]),
  entry("M24", "asterism", "dark", "7×35 / 10×50", "A window into the Milky Way, filled with a fine-grained star background. This is a star cloud, not one compact cluster.", "Sweep north from Sagittarius’s Teapot, between Mu Sagittarii and Gamma Scuti.", "63", [sky("M24")]),

  entry("DS-MizarAlcor", "double", "easy", "7×35 / 10×50", "The wide Mizar–Alcor pair is a comfortable double-star introduction. Mizar’s own close binary needs greater magnification.", "Find the bend in the Big Dipper’s handle.", "6–7, 16"),
  entry("DS-NuDra", "double", "steady", "Supported 10×50", "A nearly matched pair rewards a steady view. Rest your elbows or use a mount before judging whether it splits.", "Find the head of Draco near Hercules and identify Nu in the quadrilateral.", "72", [spring]),
  entry("DS-AlpCap", "double", "easy", "7×35 / 10×50", "Two widely separated stars make an easy optical pair. This is a pleasing field, not proof of a physical binary.", "Look for the northwestern corner of Capricornus, below the Summer Triangle.", "82"),
  entry("DS-AlpLib", "double", "easy", "7×35 / 10×50", "A bright star and a fainter, widely spaced companion make an approachable double-star stop.", "Find Libra west of Scorpius; center Zubenelgenubi.", "57"),
  entry("DS-DoubleDbl", "double", "easy", "7×35 / 10×50 for the wide pair", "Binoculars reveal the two widely spaced main stars. Splitting each into a close pair is a telescope task.", "Start at Vega and move northeast to Epsilon Lyrae.", "71"),
  entry("DS-56And", "double", "steady", "Supported 10×50", "Two similarly bright stars sit near NGC 752. A steady view lets you compare the double with the loose cluster nearby.", "Use the finder chart near the southeastern part of Andromeda, beside NGC 752.", undefined, [article("Tonkin · September double-star list", "https://binocularsky.com/newsletter/archive/201609.pdf")]),
  entry("DS-Albireo", "double", "challenge", "Well-supported 10×50 or higher power", "The gold-and-blue split depends strongly on steadiness and optics. It is a challenge at 10×; a small telescope is much easier.", "Find the foot of Cygnus’s Northern Cross, opposite Deneb.", "9, 75–76", [sky("bCyg")]),

  entry("M45", "cluster", "easy", "7×35 / 10×50; wide field", "A bright, spacious cluster that rewards low magnification. The blue-white stars are easy; reflection nebulosity is not.", "Find the small bright group northwest of Aldebaran.", "109, 112–115", [article("Harrington · The Pleiades", "https://www.cloudynights.com/articles/column/binocular-universe/binocular-universe-subaru-r1999/")]),
  entry("AST-Hyades", "cluster", "easy", "7×35 / 10×50; wide field", "Let the V-shaped cluster spill across a wide field. The brightest orange foreground star is Aldebaran, not a member.", "Follow Orion’s Belt toward Aldebaran and explore the surrounding V.", "109, 115"),
  entry("Mel20", "cluster", "easy", "7×35 / 10×50; wide field", "A loose gathering of bright young stars surrounds Mirfak. Binoculars give it the space that a narrow telescope field cannot.", "Center Mirfak in Perseus and slowly sweep the surrounding field.", undefined, [sky("Mel20")]),
  entry("Mel111", "cluster", "easy", "7×35 / 10×50; wide field", "An open scattering of stars forms Coma Berenices’s hair. Its large extent makes a broad field especially rewarding.", "Look between Denebola and Cor Caroli, around Gamma Comae Berenices.", "30–32", [article("Tonkin · Coma star cluster", "https://binocularsky.com/binoc_object_file.php?aperture=70&object_id=Mel111")]),
  { ...entry("NGC869", "cluster", "easy", "10×50", "Two neighboring clusters make a superb side-by-side comparison. Expect many points of light rather than the color of a long exposure.", "Sweep between Cassiopeia’s W and Perseus; frame both clusters together.", "117–118", [sky("Double")]), name: "Double Cluster" },
  entry("M35", "cluster", "easy", "10×50", "A bright gathering at Gemini’s foot. A dark sky reveals more of its faint, scattered members.", "Start with Gemini’s feet northeast of Orion and match the field near Eta Geminorum.", "137", [winter]),
  entry("M36", "cluster", "dark", "10×50", "A compact, grainy gathering in Auriga. Compare it with M37 and M38 rather than expecting three identical clusters.", "Find Auriga’s pentagon and use the chart to locate its central cluster trio.", "129", [winter]),
  entry("M37", "cluster", "dark", "10×50", "The richer Auriga cluster often appears as a misty patch with hints of stars. Support helps bring out its texture.", "Sweep just outside Auriga’s southeastern side, using the nearby bright stars as a bracket.", "129", [winter]),
  entry("M38", "cluster", "dark", "10×50", "A loose, faint gathering in a busy Milky Way field. Compare its size with the neighboring Auriga clusters.", "Work across Auriga’s interior, matching the finder field before moving toward M36.", "129", [winter]),
  entry("M41", "cluster", "easy", "10×50", "A bright open cluster south of Sirius. It is a good reminder that a simple sweep can lead to a rewarding field.", "Start at Sirius and move about four degrees south.", "131", [sky("M41")]),
  entry("M44", "cluster", "easy", "7×35 / 10×50", "The Beehive is a loose swarm that fits binoculars beautifully. Look for small triangles and pairs within the cluster.", "Locate the faint constellation Cancer between Gemini and Leo.", "26–28", [sky("M44")]),
  entry("M46", "cluster", "dark", "10×50", "A soft, fine-grained cluster beside the more obviously stellar M47. Its embedded planetary nebula needs a telescope.", "Explore Puppis east of Sirius and compare M46 with nearby M47.", "132–133", [sky("M46")]),
  entry("M47", "cluster", "easy", "10×50", "A handful of bright stars makes this cluster stand out. Frame it with M46 and compare their very different textures.", "Sweep east of Sirius into Puppis and locate the brighter of the paired clusters.", "132–133", [winter]),
  entry("M52", "cluster", "dark", "10×50", "A small cluster with a bright foreground star nearby. Dark, steady conditions reveal the fainter grainy background.", "Extend Cassiopeia’s Alpha-to-Beta line beyond Beta and use the finder field.", "94", [article("Harrington · Cassiopeia cluster tour", "https://www.astronomy.com/observing/phil-harringtons-binocular-universe-you-connect-the-dots/")]),
  entry("NGC752", "cluster", "dark", "10×50", "A large, loose cluster that benefits from a wide view. Nearby 56 Andromedae makes a useful contrasting double-star stop.", "Find the southeastern part of Andromeda and center the field beside 56 Andromedae.", "102", [andromeda]),
  entry("NGC2244", "cluster", "easy", "10×50", "The central star cluster is the realistic binocular goal. The surrounding Rosette Nebula is much harder and should not be expected.", "Find Monoceros east of Orion and use the marked cluster field.", "135"),
  entry("NGC2264", "cluster", "easy", "10×50", "Bright cluster stars outline a small tree-like pattern. The Cone Nebula is not the ordinary binocular target.", "Locate 15 Monocerotis in Monoceros and inspect its neighboring stars.", "135"),
  entry("IC4665", "cluster", "easy", "7×35 / 10×50", "A broad, loose cluster with bright members. Low magnification keeps the group distinct from its surroundings.", "Find Beta Ophiuchi and move slightly north into the cluster field.", "60", [sky("IC4665")]),
  entry("IC4756", "cluster", "easy", "10×50; wide field", "A generous scattering of stars rewards a slow sweep. Compare its loose structure with neighboring NGC 6633.", "Explore the Serpens–Ophiuchus border and use the chart to bracket the field.", "60"),
  entry("NGC6633", "cluster", "easy", "10×50", "An elongated gathering in a rich field. Try identifying its brightest members before looking for the faint background.", "Locate the field in northeastern Ophiuchus, near the border with Serpens.", "60"),
  entry("M3", "cluster", "dark", "10×50", "An unresolved round glow makes a satisfying globular-cluster catch. Individual stars are a telescope reward.", "Use Arcturus and Cor Caroli to bracket the region, then match the finder chart.", "34", [sky("M3")]),
  entry("M5", "cluster", "dark", "10×50", "A compact globular glow, easy to mistake for a slightly fuzzy star at first. A stable view helps reveal the difference.", "Start in Serpens and locate the field near 5 Serpentis.", "60", [sky("M5")]),
  entry("M13", "cluster", "easy", "10×50", "A small round haze tucked into Hercules’s Keystone. Binoculars find the cluster; a telescope resolves its stars.", "Look along the western side of the Keystone, between Eta and Zeta Herculis.", "48–50", [hercules]),
  entry("M22", "cluster", "easy", "10×50", "A bright globular with a noticeably broad glow. Its low southern altitude can be the main obstacle from northern sites.", "Start near Lambda Sagittarii at the Teapot’s lid and sweep northeast.", "63", [sky("M22")]),
  entry("M92", "cluster", "dark", "10×50", "A smaller globular than M13, with a concentrated center. Comparing the two is a fine short observing project.", "Work north of Hercules’s Keystone and match the guide-star field.", "51", [hercules]),

  entry("M42", "nebula", "easy", "7×35 / 10×50", "A pale fan of nebulosity surrounds the Sword’s central stars. Expect a subtle visual glow, not photographic colors.", "Drop south from Orion’s Belt into the Sword.", "125", [sky("M42")]),
  entry("M8", "nebula", "dark", "10×50", "The Lagoon combines bright cluster stars with a soft nebulous glow. A dark sky and an open southern horizon matter.", "Sweep above Sagittarius’s Teapot into the richer Milky Way.", "63–65", [sky("M8")]),
  entry("M17", "nebula", "dark", "10×50", "A small, bright streak of nebulosity is the binocular impression. Its detailed swan shape belongs to a larger view.", "Follow the Milky Way north of M24, using the marked field in Sagittarius.", "65"),
  entry("M27", "nebula", "dark", "10×50", "A small gray patch between crowded star fields. Binoculars locate it; more power reveals its familiar dumbbell outline.", "Find Sagitta below Albireo and move north into Vulpecula.", "80", [sky("M27")]),
  entry("NGC7000", "nebula", "challenge", "Wide 10×50; very dark, transparent sky", "A huge, low-contrast patch that can vanish in light pollution. Do not confuse a rich star field with the nebula itself.", "Center the region east of Deneb and compare bright haze with the surrounding dark gaps.", "74"),

  entry("M31", "galaxy", "easy", "7×35 / 10×50", "A bright central glow sits within a much larger faint oval. Dark skies reveal more extent; spiral detail is not a binocular promise.", "Find Mirach in Andromeda and follow the nearby fainter stars toward the galaxy.", "99–102", [andromeda]),
  entry("M33", "galaxy", "challenge", "10×50; dark, transparent sky", "Large but low in surface brightness, this galaxy can be harder than its magnitude suggests. Seek a broad, very faint glow.", "Match the field between Andromeda and Triangulum; sweep slowly rather than looking for a sharp center.", "103", [andromeda]),
  entry("M81", "galaxy", "dark", "Supported 10×50; dark sky", "A small oval haze pairs with nearby M82. Both are subtle, so a stable view and careful field matching help.", "Use the Big Dipper to orient yourself, then follow the chart into the northern Ursa Major field.", "15", [article("Harrington · M81 and M82", "https://www.cloudynights.com/articles/column/binocular-universe/binocular-universe-a-galactic-dynamic-duo-r2544/")]),
  entry("M82", "galaxy", "dark", "Supported 10×50; dark sky", "Look for an elongated glow beside M81. Comparing their shapes is more realistic than expecting visible dust lanes.", "Keep M81 in view and inspect the neighboring marked galaxy position.", "16"),
  entry("NGC253", "galaxy", "dark", "10×50; clear southern horizon", "An elongated galaxy glow rewards southern observers and northern sites with an unobstructed horizon.", "Locate Sculptor below Cetus and use the chart for the galaxy field.", "105"),

  entry("IC2602", "cluster", "easy", "7×35 / 10×50", "The Southern Pleiades form an open gathering around Theta Carinae. The cluster is best enjoyed with space around it.", "Locate Theta Carinae southwest of Crux and center its surrounding cluster.", undefined, [article("Tonkin · Southern Pleiades", "https://binocularsky.com/binoc_object_file.php?aperture=50&object_id=IC2602")]),
  entry("NGC3532", "cluster", "easy", "10×50", "A rich southern cluster turns a slow Carina sweep into a sparkling star field.", "Explore Carina near the Carina Nebula, using the finder chart to separate the cluster from surrounding fields.", undefined, [{ title: "Texas Tech University · NGC 3532 observing notes", url: "https://www.phys.ttu.edu/~ozprof/3532oz09_dslr.htm", kind: "reference" }]),
  entry("NGC3372", "nebula", "dark", "7×35 / 10×50; dark sky", "The Carina Nebula spreads across a richly starred southern field. Its broad glow benefits from a wide view and a dark sky.", "Use Crux and the surrounding southern Milky Way to locate the Carina region.", undefined, [{ title: "NASA · Caldwell 92 / Carina Nebula", url: "https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-caldwell-catalog/caldwell-92/", kind: "reference" }, { title: "University of Manchester · Carina observing guide", url: "https://www.jb.man.ac.uk/astronomy/nightsky/AList/Carina.html", kind: "reference" }]),
  entry("NGC5139", "cluster", "easy", "7×35 / 10×50", "Omega Centauri shows a large, unmistakably nonstellar glow. Its far-southern position limits access from northern sites.", "Locate Centaurus west of Crux, then match the globular’s field on the chart.", undefined, [{ title: "Texas Tech University · Omega Centauri observing notes", url: "https://www.phys.ttu.edu/~ozprof/5139c.htm", kind: "reference" }]),
  entry("NGC104", "cluster", "easy", "7×35 / 10×50", "47 Tucanae offers a bright, rounded globular glow in southern skies. Check its altitude before planning from a northern location.", "Locate Tucana near the Small Magellanic Cloud and match the marked globular field.", undefined, [{ title: "NASA · Caldwell 106 / 47 Tucanae", url: "https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-caldwell-catalog/caldwell-106/", kind: "reference" }]),
  ...expandedEntries as BinocularEntry[],
];

export const BINOCULAR_BOOKS = [
  { title: "Observing the Night Sky with Binoculars", author: "Stephen James O’Meara", note: "Month-by-month discovery, colorful stars and constellations. Target coverage above is checked against the publisher’s index.", url: "https://assets.cambridge.org/97805217/21707/frontmatter/9780521721707_frontmatter.pdf", mark: "01", color: "gold" },
  { title: "Binocular Highlights", author: "Gary Seronik", note: "A compact field companion for ordinary binoculars. The revised edition offers 109 observing highlights.", url: "https://garyseronik.com/binocular-highlights-2nd-edition-now-available/", mark: "02", color: "mint" },
  { title: "Touring the Universe through Binoculars", author: "Phil Harrington", note: "A broad observing reference. Public Binocular Universe articles by the author support the linked tours in this collection.", url: "https://books.google.com/books?id=jZ9w0AEACAAJ", mark: "03", color: "blue" },
  { title: "Binocular Astronomy", author: "Craig Crossen & Wil Tirion", note: "A deeper reference with charts and context, including a separate tier for large binoculars.", url: "https://shopatsky.com/products/binocular-astronomy-2nd-edition", mark: "04", color: "gold" },
  { title: "Binocular Astronomy", author: "Stephen Tonkin", note: "Optics and observing technique. The author’s freely available BinocularSky guides add practical target notes.", url: "https://link.springer.com/book/10.1007/978-1-4614-7467-8", mark: "05", color: "mint" },
];

export interface BinocularPick extends BinocularEntry {
  target: UnifiedTarget; alt: number; az: number; monthlyAltitudes: number[];
  bestMonths: number[]; neverRises: boolean;
}
/** A clearly labeled planning sample, not a claim about the sky right now. */
export function binocularEvening(year: number, month: number, timezone: string): Date {
  return fromZonedTime(`${year}-${String(month).padStart(2, "0")}-15T21:00:00`, timezone);
}
export function binocularCollection(targets: UnifiedTarget[], lat: number, lon: number, year: number, month: number, timezone: string): BinocularPick[] {
  const dates = MONTH_NAMES.map((_, i) => binocularEvening(year, i + 1, timezone));
  const catalog = new Map(targets.map((target) => [target.id, target]));
  return BINOCULAR_ENTRIES.flatMap((guide) => {
    const target = catalog.get(guide.targetId);
    if (!target) return [];
    const monthlyAltitudes = dates.map((at) => eqToHorizontal(target.ra, target.dec, lat, lon, at).alt);
    const peak = Math.max(...monthlyAltitudes);
    // High fields remain worthwhile outside their exact peak month; low targets
    // are included near their best altitude, then checked by the horizon filter.
    const bestMonths = monthlyAltitudes.flatMap((alt, i) => alt >= Math.min(40, peak - 18) ? [i + 1] : []);
    const position = eqToHorizontal(target.ra, target.dec, lat, lon, dates[month - 1]);
    return [{ ...guide, target, ...position, monthlyAltitudes, bestMonths, neverRises: 90 - Math.abs(lat - target.dec) <= 0 }];
  }).sort((a, b) => (b.alt + (b.level === "easy" ? 12 : 0)) - (a.alt + (a.level === "easy" ? 12 : 0)));
}
