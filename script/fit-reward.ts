/**
 * Fit the binocular reward model (client/src/lib/visibility/reward.ts) on the researched scores and write the shipped
 * data. Run: `npx tsx script/fit-reward.ts`
 *
 * Input:  docs/binocular-reward-sources.json  (dev-only research: score, confidence, why, traits, evidence, QA notes)
 * Output: client/src/lib/visibility/reward-data.json   {id: {reward, confidence, why, traits}} — no sources (UI rule)
 *         client/src/lib/visibility/reward-model.json  ridge-regression coefficients + cross-validated metrics
 *
 * Model: weighted ridge regression (weights high 1 · medium 1 · low 0.5; λ on the physical features only, class
 * intercepts unpenalised) on the features of reward.ts rewardFeatures() at the 10×50 dark-sky reference.
 * Validation: leave-one-out MAE and Spearman rank correlation.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildUnifiedTargets, type BinocularTarget, type MessierObject } from '../client/src/lib/astronomy';
import type { KbObject } from '../client/src/lib/journeys/types';
import { REWARD_FEATURES, rewardExtrasFromKb, rewardFeatures, type RewardFeature } from '../client/src/lib/visibility/reward';
import { toVisibilityTarget } from '../client/src/lib/visibility/targets';

const ROOT = resolve(import.meta.dirname, '..');
const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

function parseRA(s: string) { const m = s.match(/(\d+)h\s*(\d+(?:\.\d+)?)m?\s*(\d+(?:\.\d+)?)?s?/); return m ? (Number(m[1]) + Number(m[2]) / 60 + (m[3] ? Number(m[3]) : 0) / 3600) * 15 : 0; }
function parseDec(s: string) { const m = s.match(/([+-−]?)(\d+)°\s*(\d+(?:\.\d+)?)′?\s*(\d+(?:\.\d+)?)?/); if (!m) return 0; const v = Number(m[2]) + Number(m[3]) / 60 + (m[4] ? Number(m[4]) : 0) / 3600; return m[1] === '-' || m[1] === '−' ? -v : v; }

interface Research { id: string; name: string; reward: number; confidence: 'high' | 'medium' | 'low'; why: string; traits: string[] }
const research: Research[] = read('docs/binocular-reward-sources.json').objects;
const messier: MessierObject[] = read('client/public/data/messier.json').map((m: Record<string, string>) => ({ id: m.M, m: m.M, ngc: m.NGC, type: m.T, mag: Number(m.V), ra: parseRA(m.RA), dec: parseDec(m.Dec), constellation: m.Con, name: m.N, size: m.S }));
const binocular: BinocularTarget[] = read('client/public/data/binocular-catalog.json').map((t: Record<string, unknown>) => ({ ...t, ra: parseRA(t.ra as string), dec: parseDec(t.dec as string) }));
const targets = new Map(buildUnifiedTargets(messier, binocular).map((t) => [t.id, t]));
const kb = new Map((read('client/public/data/journeys/kb.json').objects as KbObject[]).map((o) => [o.id, o]));

const WEIGHT = { high: 1, medium: 1, low: 0.5 } as const;
const PENALISED = new Set<RewardFeature>(REWARD_FEATURES.slice(9));
const LAMBDA = 2;

const rows = research.map((r) => {
  const t = targets.get(r.id);
  if (!t) throw new Error(`research id ${r.id} is not a unified target`);
  const k = kb.get(r.id);
  const f = rewardFeatures(toVisibilityTarget(t), undefined, k ? rewardExtrasFromKb(k) : {});
  return { r, x: REWARD_FEATURES.map((name) => f[name]), y: r.reward, w: WEIGHT[r.confidence], category: t.category };
});

function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) { M[c][c] = 1e-12; }
    for (let i = 0; i < n; i++) if (i !== c) { const f = M[i][c] / M[c][c]; for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}
function fit(data: typeof rows): number[] {
  const p = REWARD_FEATURES.length, A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (const { x, y, w } of data) for (let i = 0; i < p; i++) { b[i] += w * x[i] * y; for (let j = 0; j < p; j++) A[i][j] += w * x[i] * x[j]; }
  REWARD_FEATURES.forEach((name, i) => { A[i][i] += PENALISED.has(name) ? LAMBDA : 1e-3; });
  return solve(A, b);
}
const predict = (beta: number[], x: number[]) => Math.min(10, Math.max(0, x.reduce((s, v, i) => s + v * beta[i], 0)));
function ranks(v: number[]) { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; }
function pearson(a: number[], b: number[]) { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return num / Math.sqrt(da * db); }
const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));
const mae = (a: number[], b: number[]) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0) / a.length;

const beta = fit(rows);
const fitted = rows.map((row) => predict(beta, row.x));
const loo = rows.map((row, i) => predict(fit(rows.filter((_, j) => j !== i)), row.x));
const ys = rows.map((row) => row.y);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const metrics = { n: rows.length, lambda: LAMBDA, trainMAE: r3(mae(fitted, ys)), trainSpearman: r3(spearman(fitted, ys)), looMAE: r3(mae(loo, ys)), looSpearman: r3(spearman(loo, ys)) };
console.log('metrics', metrics);
const groups = new Map<string, number[]>();
rows.forEach((row, i) => { const g = groups.get(row.category) ?? []; g.push(i); groups.set(row.category, g); });
for (const [cat, idx] of [...groups].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${cat.padEnd(20)} n=${String(idx.length).padStart(3)} LOO MAE ${mae(idx.map((i) => loo[i]), idx.map((i) => ys[i])).toFixed(2)}`);
console.log('coefficients'); REWARD_FEATURES.forEach((name, i) => console.log(`  ${name.padEnd(16)} ${beta[i].toFixed(3)}`));
console.log('largest LOO residuals (research − model):');
rows.map((row, i) => ({ id: row.r.id, y: row.y, m: loo[i], c: row.r.confidence })).sort((a, b) => Math.abs(b.y - b.m) - Math.abs(a.y - a.m)).slice(0, 25)
  .forEach((e) => console.log(`  ${e.id.padEnd(22)} research ${e.y}  model ${e.m.toFixed(1)}  (${e.c})`));

writeFileSync(resolve(ROOT, 'client/src/lib/visibility/reward-model.json'), JSON.stringify({
  description: 'Generated by script/fit-reward.ts — ridge regression of researched binocular reward (0–10) on reward.ts rewardFeatures(). Do not edit by hand.',
  metrics, coefficients: Object.fromEntries(REWARD_FEATURES.map((name, i) => [name, Math.round(beta[i] * 1e4) / 1e4])),
}, null, 1) + '\n');
writeFileSync(resolve(ROOT, 'client/src/lib/visibility/reward-data.json'), JSON.stringify(Object.fromEntries(
  [...research].sort((a, b) => a.id.localeCompare(b.id)).map((r) => [r.id, { reward: r.reward, confidence: r.confidence, why: r.why, traits: r.traits }]),
)) + '\n');
console.log('wrote reward-model.json and reward-data.json');
