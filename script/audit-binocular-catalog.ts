import { readFileSync,writeFileSync } from 'node:fs';
import { loadMessier,loadBinocularTargets,buildUnifiedTargets } from '../client/src/lib/astronomy';
import { binocularAssessment,KITE_14X50 } from '../client/src/lib/binocular-assessment';
// Exercise the same catalog normalization as the browser, entirely from local files.
globalThis.fetch=(async(path:string|URL|Request)=>({ok:true,json:async()=>JSON.parse(readFileSync(`client/public/${String(path).replace(/^\.\//,'')}`,'utf8'))})) as typeof fetch;
const targets=buildUnifiedTargets(await loadMessier(),await loadBinocularTargets());
const rows=targets.map(target=>({target,assessment:binocularAssessment(target,KITE_14X50,{alt:60,skyBrightness:21.6})}));
const clean=(text:string)=>text.replaceAll('|','/').replaceAll('\n',' ');
const report=`# Portable binocular catalog audit\n\nGenerated with \`npx tsx script/audit-binocular-catalog.ts\`. All ${rows.length} objects use the same assessment function as the app.\n\nReference assumptions: KITE APC stabilized 14×50 ED, 3.7° true field, 86% transmission; target altitude 60°, Moon below the horizon, moonless sky 21.6 mag/arcsec², 6 mm observer pupil. These are estimates of visual suitability, not measured detection probabilities. The app recalculates for the actual selected altitude, Moon and user sky assumption.\n\nMissing dimensions and component separations are explicitly disclosed. Mean surface brightness can misrepresent bright cores; curated notes and explicit exceptions retain those distinctions. Telescope survey photos are not simulated binocular views.\n\n| Object | Type | Recommendation | Expected view | Evidence / uncertainty |\n| --- | --- | --- | --- | --- |\n${rows.map(({target:t,assessment:a})=>`| ${clean(t.id+' · '+t.name)} | ${t.category} | ${a.label} | ${clean(a.view)} | ${clean(a.reasons.join(' '))} |`).join('\n')}\n`;
writeFileSync('docs/binocular-catalog-audit.md',report);
console.log(JSON.stringify({objects:rows.length,ratings:[0,1,2,3].map(r=>({rating:r,count:rows.filter(row=>row.assessment.rating===r).length})),missingDimensions:rows.filter(row=>row.assessment.reasons.some(r=>r.includes('dimensions are missing'))).length},null,2));
