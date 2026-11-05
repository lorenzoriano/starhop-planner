#!/usr/bin/env python3
"""Sky Journeys learned scorer: label aggregation, training, evaluation, ship gate, export (doc 05 §7.3-§7.6).

Run with uv (nothing is installed in the system Python):

    uv run --no-project --with lightgbm==4.7.0 --with numpy --with scikit-learn \
        python script/journeys/train/train.py <command> [options]

Commands
  aggregate  judge outputs (judgments.jsonl) + candidates.jsonl -> labeled.jsonl
             per-judge z-scores, run-order consistency filter (Kendall tau < 0.2 dropped), persona weights,
             graded 0-4 labels by within-slate rank with an absolute anchor, Kendall's W slate filter (< 0.3).
  train      labeled.jsonl -> model.json (+ golden-vectors.json, model-card.md)
             grouped split by site x month (70/15/15) plus a geographic hold-out; LightGBM lambdarank
             (<= 150 trees x 8 leaves, monotone constraints) and a Bradley-Terry linear ranker; evaluation
             against random, the engine heuristic h, the feature heuristic and doc 04's Q; the ship gate
             decides which tier is exported.
  toy        synthetic slates with a known monotone utility -> tiny GBDT + linear models and golden vectors
             for the TypeScript parity test (client/src/lib/journeys/__fixtures__/scorer-toy-*.json).

The feature list, clip ranges and monotone constraints come from feature-meta.json, which is generated from
client/src/lib/journeys/features.ts (run-export.cts --meta-only), so Python never redefines features.
Only numpy and lightgbm's core API are used (scikit-learn is optional and unused).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_META = os.path.join(HERE, "feature-meta.json")

# Persona weights (doc 05 §7.3.5): students share 0.2 in total. Unknown personas count as students.
CORE_WEIGHTS = {"educator": 0.30, "astronomer": 0.25, "observer": 0.25}
STUDENT_TOTAL = 0.20
LABEL_BY_RANK = [4, 3, 2, 2, 1, 0]
CONSENSUS_MARGIN = 0.5
MIN_ORDER_TAU = 0.2
MIN_KENDALL_W = 0.3
MAX_TREES = 150


# ───────────────────────────── io ─────────────────────────────

def read_jsonl(path):
    with open(path, encoding="utf8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def write_jsonl(path, rows):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf8") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")


def write_json(path, obj, indent=None):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf8") as fh:
        json.dump(obj, fh, indent=indent)
        fh.write("\n")


def load_meta(path):
    with open(path, encoding="utf8") as fh:
        meta = json.load(fh)
    assert len(meta["featureNames"]) == 36, "feature-meta.json must list 36 features"
    return meta


# ───────────────────────────── rank statistics ─────────────────────────────

def kendall_tau(a, b):
    """Kendall tau-b of two equal-length score lists (0 when undefined)."""
    c = d = ta = tb = 0
    n = len(a)
    for i in range(n):
        for j in range(i + 1, n):
            da = np.sign(a[j] - a[i])
            db = np.sign(b[j] - b[i])
            if da == 0 and db == 0:
                continue
            if da == 0:
                ta += 1
            elif db == 0:
                tb += 1
            elif da == db:
                c += 1
            else:
                d += 1
    den = math.sqrt((c + d + ta) * (c + d + tb))
    return (c - d) / den if den > 0 else 0.0


def kendall_w(score_rows):
    """Kendall's W (concordance) of m judges' scores over the same n items (rows = judges)."""
    m = len(score_rows)
    if m < 2:
        return 1.0
    n = len(score_rows[0])
    if n < 2:
        return 1.0
    ranks = np.array([np.argsort(np.argsort(-np.asarray(r, dtype=float), kind="stable"), kind="stable") + 1 for r in score_rows], dtype=float)
    R = ranks.sum(axis=0)
    S = float(((R - R.mean()) ** 2).sum())
    return 12.0 * S / (m * m * (n ** 3 - n))


def wilson_interval(k, n, z=1.96):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (centre - half, centre + half)


# ───────────────────────────── aggregate ─────────────────────────────

def persona_weights(personas):
    students = [p for p in personas if p not in CORE_WEIGHTS]
    w = {p: CORE_WEIGHTS[p] for p in personas if p in CORE_WEIGHTS}
    for p in students:
        w[p] = STUDENT_TOTAL / len(students)
    total = sum(w.values()) or 1.0
    return {p: v / total for p, v in w.items()}


def aggregate(candidates_path, judgments_path, out_path):
    cands = read_jsonl(candidates_path)
    judg = read_jsonl(judgments_path)
    by_key = {(r["slateId"], r["journeyKey"]): r for r in cands}

    # 1. z-score each judge's `overall` within that judge's whole history (removes leniency).
    hist = defaultdict(list)
    for j in judg:
        for v in j["perJourney"].values():
            hist[j["persona"]].append(float(v["overall"]))
    stats = {p: (float(np.mean(v)), float(np.std(v)) or 1.0) for p, v in hist.items()}

    # 2. per (slate, persona): letters -> journey keys; per-run z; run-order consistency.
    runs = defaultdict(list)
    for j in judg:
        mapping = {chr(65 + i): k for i, k in enumerate(j["order"])}
        mu, sd = stats[j["persona"]]
        z = {mapping[letter]: (float(v["overall"]) - mu) / sd for letter, v in j["perJourney"].items() if letter in mapping}
        raw = {mapping[letter]: float(v["overall"]) for letter, v in j["perJourney"].items() if letter in mapping}
        rank_pos = {mapping[letter]: i for i, letter in enumerate(j.get("ranking", [])) if letter in mapping}
        runs[(j["slateId"], j["persona"])].append({"z": z, "raw": raw, "rank": rank_pos})

    slates = defaultdict(dict)
    log = {"orderInconsistent": 0, "lowW": 0, "slates": 0, "kept": 0}
    for (slate, persona), rs in runs.items():
        if len(rs) >= 2:
            keys = sorted(set(rs[0]["rank"]) & set(rs[1]["rank"]))
            if len(keys) >= 3:
                tau = kendall_tau([-rs[0]["rank"][k] for k in keys], [-rs[1]["rank"][k] for k in keys])
                if tau < MIN_ORDER_TAU:
                    log["orderInconsistent"] += 1
                    continue
        keys = sorted(set().union(*[r["z"].keys() for r in rs]))
        slates[slate][persona] = {
            "z": {k: float(np.mean([r["z"][k] for r in rs if k in r["z"]])) for k in keys},
            "raw": {k: float(np.mean([r["raw"][k] for r in rs if k in r["raw"]])) for k in keys},
        }

    out = []
    for slate, per in sorted(slates.items()):
        log["slates"] += 1
        keys = sorted(set.intersection(*[set(v["z"]) for v in per.values()])) if per else []
        if len(keys) < 2:
            continue
        personas = sorted(per)
        if len(personas) >= 2 and kendall_w([[per[p]["z"][k] for k in keys] for p in personas]) < MIN_KENDALL_W:
            log["lowW"] += 1
            continue
        w = persona_weights(personas)
        cz = {k: sum(w[p] * per[p]["z"][k] for p in personas) for k in keys}
        raw_mean = {k: float(np.mean([per[p]["raw"][k] for p in personas])) for k in keys}
        order = sorted(keys, key=lambda k: (-cz[k], k))
        pattern = LABEL_BY_RANK if len(keys) == 6 else [round(4 * (1 - i / max(1, len(keys) - 1))) for i in range(len(keys))]
        cap = 2 if max(raw_mean.values()) < 5.0 else 4  # absolute anchor: all judged poor -> labels <= 2
        for pos, k in enumerate(order):
            c = by_key.get((slate, k))
            if c is None:
                continue
            out.append({
                "slateId": slate, "splitKey": c["splitKey"], "site": c.get("site"), "journeyKey": k,
                "features": c["features"], "label": min(cap, pattern[pos]), "consensusZ": cz[k],
                "personaZ": {p: per[p]["z"][k] for p in personas}, "scores": c.get("scores", {}),
            })
        log["kept"] += 1
    write_jsonl(out_path, out)
    print(json.dumps({"aggregate": log, "rows": len(out)}))
    return out


# ───────────────────────────── data matrices ─────────────────────────────

def split_of(row, holdout_sites):
    if row.get("site") in holdout_sites:
        return "holdout"
    h = int(hashlib.md5(row["splitKey"].encode()).hexdigest(), 16) % 100
    return "train" if h < 70 else "val" if h < 85 else "test"


def to_groups(rows):
    """Rows sorted by slate -> (X, y, group sizes, slates list)."""
    rows = sorted(rows, key=lambda r: (r["slateId"], r["journeyKey"]))
    slates = []
    for r in rows:
        if not slates or slates[-1][0] != r["slateId"]:
            slates.append((r["slateId"], []))
        slates[-1][1].append(r)
    X = np.array([r["features"] for r in rows], dtype=np.float64)
    y = np.array([int(r["label"]) for r in rows], dtype=np.int32)
    sizes = [len(s[1]) for s in slates]
    return rows, X, y, sizes, slates


# ───────────────────────────── metrics ─────────────────────────────

def consensus_pairs(slate_rows):
    """(winner idx, loser idx) pairs with consensus margin >= 0.5 z (labels when z is absent)."""
    pairs = []
    for i, a in enumerate(slate_rows):
        for j, b in enumerate(slate_rows):
            za, zb = a.get("consensusZ"), b.get("consensusZ")
            if za is not None and zb is not None:
                if za - zb >= CONSENSUS_MARGIN:
                    pairs.append((i, j))
            elif a["label"] > b["label"]:
                pairs.append((i, j))
    return pairs


def pairwise_accuracy(slates, scores_by_slate):
    hit = tot = 0.0
    for (sid, rows) in slates:
        s = scores_by_slate[sid]
        for i, j in consensus_pairs(rows):
            tot += 1
            hit += 1.0 if s[i] > s[j] else 0.5 if s[i] == s[j] else 0.0
    return hit / tot if tot else float("nan"), int(tot)


def ndcg_at(labels, scores, k):
    order = sorted(range(len(scores)), key=lambda i: (-scores[i], i))[:k]
    dcg = sum((2 ** labels[i] - 1) / math.log2(r + 2) for r, i in enumerate(order))
    ideal = sorted(labels, reverse=True)[:k]
    idcg = sum((2 ** l - 1) / math.log2(r + 2) for r, l in enumerate(ideal))
    return dcg / idcg if idcg > 0 else None


def mean_ndcg(slates, scores_by_slate, k):
    vals = [ndcg_at([r["label"] for r in rows], scores_by_slate[sid], k) for sid, rows in slates]
    vals = [v for v in vals if v is not None]
    return float(np.mean(vals)) if vals else float("nan")


def judge_ceiling(slates):
    """Leave-one-persona-out agreement with the rest of the panel (the realistic upper bound)."""
    hit = tot = 0
    for _, rows in slates:
        personas = sorted(set().union(*[set(r.get("personaZ", {})) for r in rows]))
        if len(personas) < 2:
            continue
        for p in personas:
            others = [q for q in personas if q != p]
            rest = [float(np.mean([r["personaZ"][q] for q in others if q in r["personaZ"]])) for r in rows]
            mine = [r["personaZ"].get(p) for r in rows]
            for i in range(len(rows)):
                for j in range(len(rows)):
                    if rest[i] - rest[j] >= CONSENSUS_MARGIN and mine[i] is not None and mine[j] is not None:
                        tot += 1
                        hit += 1 if mine[i] > mine[j] else 0
    return hit / tot if tot else None


def evaluate(slates, scorers):
    out = {}
    for name, fn in scorers.items():
        by = {sid: [fn(r) for r in rows] for sid, rows in slates}
        acc, npairs = pairwise_accuracy(slates, by)
        out[name] = {"pairAcc": acc, "pairs": npairs, "ndcg1": mean_ndcg(slates, by, 1), "ndcg3": mean_ndcg(slates, by, 3)}
    return out


# ───────────────────────────── GBDT ─────────────────────────────

def gbdt_params(n_train, mono, seed=7):
    return {
        "objective": "lambdarank",
        "metric": "ndcg",
        "eval_at": [1, 3],
        "num_leaves": 8,
        "max_depth": 3,
        "learning_rate": 0.05,
        "min_data_in_leaf": int(max(2, min(20, n_train // 20))),
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "lambdarank_truncation_level": 6,
        "label_gain": [0, 1, 3, 7, 15],
        "monotone_constraints": list(mono),
        "monotone_constraints_method": "advanced",
        "seed": seed,
        "deterministic": True,
        "force_row_wise": True,
        "num_threads": 1,
        "verbose": -1,
    }


def train_gbdt(Xtr, ytr, gtr, Xva, yva, gva, mono, rounds=MAX_TREES, use_monotone=True):
    import lightgbm as lgb

    params = gbdt_params(len(ytr), mono if use_monotone else [0] * Xtr.shape[1])
    dtr = lgb.Dataset(Xtr, ytr, group=gtr, free_raw_data=False)
    valid = [lgb.Dataset(Xva, yva, group=gva, reference=dtr)] if len(gva) else []
    callbacks = [lgb.early_stopping(30, first_metric_only=False, verbose=False)] if valid else []
    booster = lgb.train(params, dtr, num_boost_round=min(rounds, MAX_TREES), valid_sets=valid, callbacks=callbacks)
    return booster


def gbdt_to_compact(booster, meta, model_version, trained_on):
    """LightGBM dump_model() -> doc 05 §7.5 compact arrays (preorder internal nodes; leaves = ~leafIndex)."""
    dump = booster.dump_model(num_iteration=booster.best_iteration or None)
    assert dump.get("num_tree_per_iteration", 1) == 1, "multi-class models are not supported"
    trees = []
    for info in dump["tree_info"]:
        ts = info["tree_structure"]
        f, t, l, r, v = [], [], [], [], []

        def visit(node):
            if "split_feature" not in node:
                v.append(float(node["leaf_value"]))
                return ~(len(v) - 1)
            assert node["decision_type"] == "<=", f"unsupported split {node['decision_type']}"
            assert node.get("missing_type", "None") != "Zero", "zero-as-missing splits are not supported"
            idx = len(f)
            f.append(int(node["split_feature"]))
            t.append(float(node["threshold"]))
            l.append(0)
            r.append(0)
            l[idx] = visit(node["left_child"])
            r[idx] = visit(node["right_child"])
            return idx

        visit(ts)
        trees.append({"f": f, "t": t, "l": l, "r": r, "v": v})
    return {
        "type": "gbdt",
        "modelVersion": model_version,
        "features": list(meta["featureNames"]),
        "base": 0.0,
        "trees": trees,
        "trainedOn": trained_on,
    }


def predict_compact(model, X):
    """Python mirror of score.ts scoreGbdt / scoreLinear (verifies the export before writing it)."""
    X = np.asarray(X, dtype=np.float64)
    if model["type"] == "linear":
        return model["b"] + ((X - np.array(model["mean"])) / np.array(model["std"])) @ np.array(model["w"])
    out = np.full(X.shape[0], float(model["base"]))
    for n in range(X.shape[0]):
        s = float(model["base"])
        for tr in model["trees"]:
            if not tr["f"]:
                s += tr["v"][0]
                continue
            node = 0
            while True:
                nxt = tr["l"][node] if X[n, tr["f"][node]] <= tr["t"][node] else tr["r"][node]
                if nxt < 0:
                    s += tr["v"][~nxt]
                    break
                node = nxt
        out[n] = s
    return out


# ───────────────────────────── Bradley–Terry linear ─────────────────────────────

def train_linear(rows_slates, X_index, X, mono, l2=1.0, iters=30):
    """Pairwise logistic (Bradley–Terry) on standardised feature differences, L2, Newton steps.

    Weights whose sign contradicts a monotone constraint are projected to 0 after every step.
    """
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    std[std < 1e-9] = 1.0
    Z = (X - mean) / std
    D = []
    for sid, rows in rows_slates:
        for i, j in consensus_pairs(rows):
            D.append(Z[X_index[(sid, rows[i]["journeyKey"])]] - Z[X_index[(sid, rows[j]["journeyKey"])]])
    d = X.shape[1]
    w = np.zeros(d)
    if not D:
        return {"mean": mean, "std": std, "w": w}
    D = np.array(D)
    mono = np.array(mono, dtype=float)
    for _ in range(iters):
        m = D @ w
        p = 1.0 / (1.0 + np.exp(m))  # P(wrong order)
        grad = -(D * p[:, None]).sum(axis=0) + l2 * w
        H = (D * (p * (1 - p))[:, None]).T @ D + l2 * np.eye(d)
        w = w - np.linalg.solve(H, grad)
        w[(mono > 0) & (w < 0)] = 0.0
        w[(mono < 0) & (w > 0)] = 0.0
    return {"mean": mean, "std": std, "w": w}


def linear_model_json(lin, meta, model_version, metrics=None):
    return {
        "type": "linear",
        "modelVersion": model_version,
        "features": list(meta["featureNames"]),
        "mean": [float(x) for x in lin["mean"]],
        "std": [float(x) for x in lin["std"]],
        "w": [float(x) for x in lin["w"]],
        "b": 0.0,
        **({"metrics": metrics} if metrics else {}),
    }


# ───────────────────────────── train command ─────────────────────────────

def heuristic_fn(meta):
    w = np.array(meta["heuristicModel"]["weights"])
    return lambda r: float(np.dot(w, r["features"]))


def run_training(rows, meta, args):
    holdout = set(s.strip() for s in (args.holdout_sites or "").split(",") if s.strip())
    parts = defaultdict(list)
    for r in rows:
        parts[split_of(r, holdout)].append(r)
    mono = meta["monotone"]
    tr_rows, Xtr, ytr, gtr, tr_slates = to_groups(parts["train"])
    va_rows, Xva, yva, gva, va_slates = to_groups(parts["val"])
    te_rows, Xte, yte, gte, te_slates = to_groups(parts["test"]) if parts["test"] else ([], np.zeros((0, 36)), [], [], [])
    ho = to_groups(parts["holdout"]) if parts["holdout"] else None
    if not len(ytr):
        sys.exit("no training rows")
    model_version = args.model_version or f"jr-{_dt.date.today().isoformat()}"
    trained_on = {"slates": len(gtr) + len(gva) + len(gte), "date": _dt.date.today().isoformat(),
                  "kbVersion": args.kb_version or "unknown", "featuresHash": meta["featuresHash"]}

    booster = train_gbdt(Xtr, ytr, gtr, Xva, yva, gva, mono)
    gbdt = gbdt_to_compact(booster, meta, model_version, trained_on)
    check = np.vstack([Xtr[:200], Xte[:200]]) if len(yte) else Xtr[:200]
    lgb_pred = booster.predict(check, raw_score=True, num_iteration=booster.best_iteration or None)
    assert np.max(np.abs(lgb_pred - predict_compact(gbdt, check))) < 1e-9, "compact GBDT disagrees with LightGBM"

    index = {}
    allX = []
    for sid, rs in tr_slates:
        for r in rs:
            index[(sid, r["journeyKey"])] = len(allX)
            allX.append(r["features"])
    lin = train_linear(tr_slates, index, np.array(allX, dtype=np.float64), mono, l2=args.l2)
    linear = linear_model_json(lin, meta, model_version)

    rnd = np.random.default_rng(7)
    rand_cache = {}

    def random_fn(r):
        k = (r["slateId"], r["journeyKey"])
        if k not in rand_cache:
            rand_cache[k] = float(rnd.random())
        return rand_cache[k]

    scorers = {
        "random": random_fn,
        "heuristic_h": lambda r: float(r.get("scores", {}).get("engineH", 0.0)),
        "heuristic_features": heuristic_fn(meta),
        "doc04_Q": lambda r: float(r.get("scores", {}).get("doc04Q", 0.0)),
        "linear": lambda r: float(predict_compact(linear, [r["features"]])[0]),
        "gbdt": lambda r: float(predict_compact(gbdt, [r["features"]])[0]),
    }
    eval_slates = te_slates if te_slates else va_slates
    metrics = {"test": evaluate(eval_slates, scorers)}
    if ho:
        metrics["holdout"] = evaluate(ho[4], scorers)
    ceiling = judge_ceiling(eval_slates)
    metrics["judgeCeiling"] = ceiling
    metrics["trees"] = len(gbdt["trees"])

    # Top-1 win rate from a fresh A/B judge panel (doc 05 §7.6): rows {"winner": "model"|"heuristic"|"tie"}.
    winrate = None
    if args.winrate and os.path.exists(args.winrate):
        ab = read_jsonl(args.winrate)
        wins = sum(1 for a in ab if a["winner"] == "model")
        losses = sum(1 for a in ab if a["winner"] == "heuristic")
        lo, hi = wilson_interval(wins, wins + losses)
        winrate = {"wins": wins, "losses": losses, "rate": wins / max(1, wins + losses), "ciLow": lo, "ciHigh": hi}
    metrics["top1WinRate"] = winrate

    if args.ablations:
        metrics["ablations"] = run_ablations(tr_slates, va_slates, eval_slates, Xtr, ytr, gtr, Xva, yva, gva, meta)

    gate = ship_gate(metrics, winrate, args.waive_winrate)
    metrics["gate"] = gate
    winner = {"gbdt": gbdt, "linear": linear}.get(gate["ship"])
    if winner is None:
        winner = dict(meta["heuristicModel"])
    flat = {
        "testPairAcc": metrics["test"].get(gate["ship"] if gate["ship"] in ("gbdt", "linear") else "heuristic_features", {}).get("pairAcc", float("nan")),
        "testNdcg3": metrics["test"].get(gate["ship"] if gate["ship"] in ("gbdt", "linear") else "heuristic_features", {}).get("ndcg3", float("nan")),
        "judgeCeiling": ceiling if ceiling is not None else float("nan"),
        "heuristicPairAcc": metrics["test"]["heuristic_h"]["pairAcc"],
    }
    winner["metrics"] = {k: float(v) for k, v in flat.items() if v is not None and not (isinstance(v, float) and math.isnan(v))}
    write_json(args.out, winner)
    golden_rows = (Xte if len(yte) else Xva)[:60]
    write_json(args.golden, {
        "featureNames": meta["featureNames"],
        "vectors": [[float(x) for x in row] for row in golden_rows],
        "gbdt": [float(s) for s in predict_compact(gbdt, golden_rows)] if len(golden_rows) else [],
        "linear": [float(s) for s in predict_compact(linear, golden_rows)] if len(golden_rows) else [],
    })
    if args.card:
        write_model_card(args.card, metrics, gate, trained_on, model_version)
    if args.also_write_candidates:
        write_json(os.path.join(os.path.dirname(os.path.abspath(args.out)), "candidate-gbdt.json"), gbdt)
        write_json(os.path.join(os.path.dirname(os.path.abspath(args.out)), "candidate-linear.json"), linear)
    print(json.dumps({"ship": gate["ship"], "metrics": metrics}, indent=2, default=float))
    return gbdt, linear, metrics


def ship_gate(metrics, winrate, waive_winrate=False):
    """doc 05 §7.6: acc >= heuristic + 5 pts, >= 85 % of judge ceiling, top-1 win-rate CI low > 50 %."""
    t = metrics["test"]
    base = t["heuristic_h"]["pairAcc"]
    if base is None or math.isnan(base):
        base = t["heuristic_features"]["pairAcc"]
    ceiling = metrics.get("judgeCeiling")
    reasons = {}
    for name in ("gbdt", "linear"):
        acc = t[name]["pairAcc"]
        checks = {
            "beatsHeuristicBy5": bool(acc >= base + 0.05),
            "ceiling85": bool(ceiling is not None and acc >= 0.85 * ceiling),
            "winRateCI": bool(winrate is not None and winrate["ciLow"] > 0.5) or bool(waive_winrate),
        }
        reasons[name] = checks
        if all(checks.values()):
            return {"ship": name, "checks": reasons, "winRateWaived": bool(waive_winrate)}
    return {"ship": "heuristic", "checks": reasons, "winRateWaived": bool(waive_winrate)}


def run_ablations(tr_slates, va_slates, ev_slates, Xtr, ytr, gtr, Xva, yva, gva, meta):
    names = meta["featureNames"]
    out = {}

    def acc_of(booster, keep):
        def fn(r):
            x = np.array(r["features"], dtype=np.float64)
            x[~keep] = 0.0
            return float(booster.predict(x[None, :], raw_score=True)[0])
        by = {sid: [fn(r) for r in rows] for sid, rows in ev_slates}
        return pairwise_accuracy(ev_slates, by)[0]

    full = np.ones(36, dtype=bool)
    for group, feats in meta["groups"].items():
        keep = np.array([n not in feats for n in names])
        b = train_gbdt(np.where(keep, Xtr, 0.0), ytr, gtr, np.where(keep, Xva, 0.0), yva, gva, meta["monotone"])
        out[f"drop_{group}"] = acc_of(b, keep)
    b = train_gbdt(Xtr, ytr, gtr, Xva, yva, gva, meta["monotone"], use_monotone=False)
    out["no_monotone"] = acc_of(b, full)
    n = len(gtr)
    for frac in (0.25, 0.5):
        k = max(1, int(n * frac))
        rows_k = sum(gtr[:k])
        b = train_gbdt(Xtr[:rows_k], ytr[:rows_k], gtr[:k], Xva, yva, gva, meta["monotone"])
        out[f"train_{int(frac * 100)}pct"] = acc_of(b, full)
    return out


def write_model_card(path, metrics, gate, trained_on, model_version):
    lines = [f"# Sky Journeys scorer model card — {model_version}", "",
             f"Trained {trained_on['date']} on {trained_on['slates']} slates (KB {trained_on['kbVersion']}, features {trained_on['featuresHash']}).",
             f"Shipped tier: **{gate['ship']}** (gate checks: `{json.dumps(gate['checks'])}`).", "",
             "| scorer | pair acc | pairs | NDCG@1 | NDCG@3 |", "|---|---|---|---|---|"]
    for name, m in metrics["test"].items():
        lines.append(f"| {name} | {m['pairAcc']:.3f} | {m['pairs']} | {m['ndcg1']:.3f} | {m['ndcg3']:.3f} |")
    lines += ["", f"Judge ceiling: {metrics.get('judgeCeiling')}", f"Top-1 win rate: {metrics.get('top1WinRate')}"]
    if "ablations" in metrics:
        lines += ["", "Ablations (test pair accuracy): `" + json.dumps(metrics["ablations"]) + "`"]
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf8") as fh:
        fh.write("\n".join(lines) + "\n")


# ───────────────────────────── toy command ─────────────────────────────

def toy(meta, args):
    """Synthetic slates with a known monotone utility; exports tiny models + golden vectors for TS parity."""
    rng = np.random.default_rng(args.seed)
    lo = np.array([r[0] for r in meta["ranges"]], dtype=float)
    hi = np.array([r[1] for r in meta["ranges"]], dtype=float)
    mono = np.array(meta["monotone"], dtype=float)
    names = meta["featureNames"]
    idx = {n: i for i, n in enumerate(names)}
    personas = ["astronomer", "educator", "observer", "student-curious-adult"]
    rows = []
    for s in range(args.slates):
        X = lo + (hi - lo) * rng.random((6, 36))
        X = np.round(X, 2)  # coarse grid: equal values and threshold ties actually occur
        X[:, idx["n_stops"]] = np.round(X[:, idx["n_stops"]])
        norm = (X - lo) / (hi - lo)
        u = norm @ (mono * 1.0) + 1.5 * norm[:, idx["interest_mean"]] * norm[:, idx["edge_strength_mean"]] \
            + 0.8 * norm[:, idx["progression_rho"]] - 0.6 * norm[:, idx["theme_drift"]]
        z = (u - u.mean()) / (u.std() or 1.0)
        site = f"toy-site-{s % 60}"
        order = np.argsort(-z, kind="stable")
        labels = np.empty(6, dtype=int)
        labels[order] = LABEL_BY_RANK
        for k in range(6):
            pz = {p: float(z[k] + rng.normal(0, 0.6)) for p in personas}
            rows.append({"slateId": f"toy{s:04d}", "splitKey": f"{site}|{s % 7 + 1}", "site": site,
                         "journeyKey": f"j{k}", "features": [float(x) for x in X[k]], "label": int(labels[k]),
                         "consensusZ": float(z[k] + rng.normal(0, 0.2)), "personaZ": pz,
                         "scores": {"engineH": float(u[k] + rng.normal(0, 0.8)), "doc04Q": 0.0}})
    import lightgbm as lgb  # noqa: F401  (fail early if missing)

    parts = defaultdict(list)
    for r in rows:
        parts[split_of(r, set())].append(r)
    _, Xtr, ytr, gtr, tr_slates = to_groups(parts["train"])
    _, Xva, yva, gva, _ = to_groups(parts["val"])
    _, Xte, _, _, te_slates = to_groups(parts["test"] or parts["val"])
    booster = train_gbdt(Xtr, ytr, gtr, Xva, yva, gva, meta["monotone"], rounds=args.trees)
    trained_on = {"slates": args.slates, "date": "toy", "kbVersion": "toy", "featuresHash": meta["featuresHash"]}
    gbdt = gbdt_to_compact(booster, meta, "toy-gbdt", trained_on)
    index, allX = {}, []
    for sid, rs in tr_slates:
        for r in rs:
            index[(sid, r["journeyKey"])] = len(allX)
            allX.append(r["features"])
    linear = linear_model_json(train_linear(tr_slates, index, np.array(allX), meta["monotone"]), meta, "toy-linear")

    vecs = Xte[:24].copy()
    # Boundary vectors: a feature exactly at a split threshold must go LEFT (x <= t), as in LightGBM.
    for tr in gbdt["trees"][:6]:
        if tr["f"]:
            v = vecs[0].copy()
            v[tr["f"][0]] = tr["t"][0]
            vecs = np.vstack([vecs, v])
    lgb_pred = booster.predict(vecs, raw_score=True, num_iteration=booster.best_iteration or None)
    mine = predict_compact(gbdt, vecs)
    assert np.max(np.abs(lgb_pred - mine)) < 1e-9, f"compact export mismatch {np.max(np.abs(lgb_pred - mine))}"
    out = args.out_dir
    write_json(os.path.join(out, "scorer-toy-gbdt.json"), gbdt)
    write_json(os.path.join(out, "scorer-toy-linear.json"), linear)
    write_json(os.path.join(out, "scorer-toy-golden.json"), {
        "note": "Generated by script/journeys/train/train.py toy; gbdt = LightGBM booster.predict(raw_score=True).",
        "featureNames": names,
        "vectors": [[float(x) for x in row] for row in vecs],
        "gbdt": [float(x) for x in lgb_pred],
        "linear": [float(x) for x in predict_compact(linear, vecs)],
    })
    scorers = {"gbdt": lambda r: float(predict_compact(gbdt, [r["features"]])[0]),
               "linear": lambda r: float(predict_compact(linear, [r["features"]])[0]),
               "heuristic_h": lambda r: r["scores"]["engineH"]}
    print(json.dumps({"toy": {"trees": len(gbdt["trees"]), "eval": evaluate(te_slates, scorers),
                              "ceiling": judge_ceiling(te_slates)}}, indent=2))


# ───────────────────────────── cli ─────────────────────────────

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("aggregate")
    a.add_argument("--candidates", required=True)
    a.add_argument("--judgments", required=True)
    a.add_argument("--out", required=True)
    t = sub.add_parser("train")
    t.add_argument("--data", required=True, help="labeled.jsonl from `aggregate`")
    t.add_argument("--meta", default=DEFAULT_META)
    t.add_argument("--out", required=True, help="model.json to write (the shipped tier)")
    t.add_argument("--golden", required=True, help="golden-vectors.json for the TS parity test")
    t.add_argument("--card", help="model-card.md path")
    t.add_argument("--holdout-sites", default="Sydney,Oslo,Nairobi")
    t.add_argument("--winrate", help="A/B judge results jsonl for the top-1 win-rate gate")
    t.add_argument("--waive-winrate", action="store_true", help="experiments only: skip the win-rate check")
    t.add_argument("--ablations", action="store_true")
    t.add_argument("--l2", type=float, default=1.0)
    t.add_argument("--model-version")
    t.add_argument("--kb-version")
    t.add_argument("--also-write-candidates", action="store_true", help="also write candidate-gbdt.json / candidate-linear.json")
    y = sub.add_parser("toy")
    y.add_argument("--meta", default=DEFAULT_META)
    y.add_argument("--out-dir", required=True)
    y.add_argument("--slates", type=int, default=300)
    y.add_argument("--trees", type=int, default=12)
    y.add_argument("--seed", type=int, default=7)
    args = ap.parse_args(argv)
    if args.cmd == "aggregate":
        aggregate(args.candidates, args.judgments, args.out)
    elif args.cmd == "train":
        run_training(read_jsonl(args.data), load_meta(args.meta), args)
    else:
        toy(load_meta(args.meta), args)


if __name__ == "__main__":
    main()
