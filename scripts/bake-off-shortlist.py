#!/usr/bin/env python3
"""
bake-off-shortlist.py — Aggregate fleet-eval results into a ranked candidate shortlist.
"""
import json
import os
import re
from collections import defaultdict
from datetime import datetime

ROOT = "/root/project/ollama-orchestrator"
RESULTS = os.path.join(ROOT, "data", "fleet-eval", "results.jsonl")
OUT_DIR = os.path.join(ROOT, "data", "bake-off")
OUT_JSON = os.path.join(OUT_DIR, "shortlist.json")
OUT_MD = os.path.join(OUT_DIR, "shortlist.md")

CLOUD_PATTERNS = [
    re.compile(r':cloud$', re.IGNORECASE),
    re.compile(r'^cloud-', re.IGNORECASE),
    re.compile(r'-cloud$', re.IGNORECASE),
]


def is_cloud_model(name):
    if not name:
        return False
    return any(p.search(name) for p in CLOUD_PATTERNS)

EMBED_PREFIXES = [
    'nomic-embed', 'mxbai-embed', 'bge-', 'jina/', 'all-minilm',
    'snowflake-arctic-embed', 'qwen3-embedding', 'gte-', 'e5-',
]

IMAGEGEN_PATTERNS = [
    re.compile(r'x/flux', re.IGNORECASE),
    re.compile(r'sdxl', re.IGNORECASE),
    re.compile(r'dall-e', re.IGNORECASE),
    re.compile(r'stable-diffusion', re.IGNORECASE),
]

DENYLIST_NAMES = {
    'evil', 'holly_tinsel-toes', 'maximus', 'mistral-nemo', 'custom-qwen3',
    'chat-rlatan', 'cpp-auditor-x', 'artifish/llama3.2-uncensored', 'fygo',
    'baytout3/qwen3.6-27b-uncensored', 'bigwest60/bible-scholar',
    'allenporter/assist-llm', 'alientelligence/mindpal', 'alientelligence/mindwell',
    'jarcgon/qwen3.6-abliterated-27b', 'syntacticluster/deepseek-coder-v2-lite',
    'gx-telecom/gemma-4-26b-a4b-it-ultra-uncensored-heretic-q5-apex',
    'robzilla/gemmabible', 'halituzun/qwen3-coder-next',
}

REPLACEMENT_TARGETS = {'qwen2.5:7b-instruct-q4_k_m', 'qwen2.5:7b'}

PARAM_SIZE_RE = re.compile(r'(?:^|:)(\d+(?:\.\d+)?b)', re.IGNORECASE)


def is_embedding_model(name):
    name_lower = name.lower()
    return any(name_lower.startswith(p.lower()) for p in EMBED_PREFIXES)


def is_imagegen_model(name):
    name_lower = name.lower()
    return any(p.search(name_lower) for p in IMAGEGEN_PATTERNS)


def is_denylist_model(name):
    name_lower = name.lower()
    if name_lower.startswith('probe_'):
        return True
    if 'archive' in name_lower:
        return True
    if name_lower in DENYLIST_NAMES:
        return True
    return False


def is_replacement_target(name):
    return name.lower() in REPLACEMENT_TARGETS


def parse_param_size(name):
    match = PARAM_SIZE_RE.search(name)
    if match:
        return float(match.group(1).lower().rstrip('b'))
    return None


def is_text_model(record):
    kind = record.get('kind', '').lower()
    if kind == 'text':
        return True
    name = record.get('model', '').lower()
    if is_embedding_model(name) or is_imagegen_model(name):
        return False
    if not kind:
        return True
    return False


def main():
    model_data = defaultdict(lambda: {'servers': set(), 'records': []})

    total_records = 0
    skipped = {'non_text': 0, 'cloud': 0, 'embedding': 0, 'imagegen': 0,
               'denylist': 0, 'replacement': 0}

    print(f"Reading {RESULTS} ...")
    with open(RESULTS, 'r') as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            total_records += 1
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                print(f"Warning: JSON parse error at line {line_no}, skipping")
                continue

            model = rec.get('model')
            if not model:
                continue

            if not is_text_model(rec):
                skipped['non_text'] += 1
                continue
            if is_cloud_model(model):
                skipped['cloud'] += 1
                continue
            if is_embedding_model(model):
                skipped['embedding'] += 1
                continue
            if is_imagegen_model(model):
                skipped['imagegen'] += 1
                continue
            if is_denylist_model(model):
                skipped['denylist'] += 1
                continue
            if is_replacement_target(model):
                skipped['replacement'] += 1
                continue

            server_url = rec.get('server_url', '')
            model_data[model]['servers'].add(server_url)

            if rec.get('available', False):
                model_data[model]['records'].append(rec)

    print(f"Total records: {total_records}")
    print(f"Unique models (before filter): {len(model_data)}")
    print(f"Skipped: {skipped}")

    candidates = []
    for model, data in model_data.items():
        server_count = len(data['servers'])
        if server_count < 5:
            continue

        records = data['records']
        availability_rate = len(records) / server_count if server_count > 0 else 0.0

        writing_vals, coding_vals, tool_use_vals, vision_vals = [], [], [], []
        for r in records:
            caps = r.get('capabilities', {})
            for key, vals in [('writing', writing_vals), ('coding', coding_vals),
                              ('tool_use', tool_use_vals), ('vision', vision_vals)]:
                v = caps.get(key)
                if v is not None:
                    vals.append(1.0 if v else 0.0)

        mean_writing = sum(writing_vals) / len(writing_vals) if writing_vals else 0.0
        mean_coding = sum(coding_vals) / len(coding_vals) if coding_vals else 0.0
        mean_tool_use = sum(tool_use_vals) / len(tool_use_vals) if tool_use_vals else 0.0
        mean_vision = sum(vision_vals) / len(vision_vals) if vision_vals else 0.0

        quality_score = (mean_writing + mean_coding + mean_tool_use) / 3.0

        if quality_score < 0.5:
            continue

        candidates.append({
            'model': model,
            'server_count': server_count,
            'availability_rate': round(availability_rate, 4),
            'quality_score': round(quality_score, 4),
            'writing': round(mean_writing, 4),
            'coding': round(mean_coding, 4),
            'tool_use': round(mean_tool_use, 4),
            'vision': round(mean_vision, 4),
            'param_size_b': parse_param_size(model),
        })

    candidates.sort(key=lambda c: (
        -c['quality_score'],
        -c['server_count'],
        c['param_size_b'] if c['param_size_b'] is not None else float('inf'),
    ))

    for i, c in enumerate(candidates, 1):
        c['rank'] = i

    total_evaluated = len(model_data)
    after_filter = len(candidates)

    print(f"After filter: {after_filter} candidates")

    os.makedirs(OUT_DIR, exist_ok=True)

    output = {
        'generated_at': int(datetime.now().timestamp()),
        'total_evaluated': total_evaluated,
        'after_filter': after_filter,
        'models': candidates,
    }
    with open(OUT_JSON, 'w') as f:
        json.dump(output, f, indent=2)
    print(f"Wrote {OUT_JSON}")

    with open(OUT_MD, 'w') as f:
        f.write("# Fleet Model Replacement — Bake-off Shortlist\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n\n")
        f.write("| Rank | Model | Servers | Quality | Writing | Coding | Tool-use | Param (B) |\n")
        f.write("|------|-------|---------|---------|---------|--------|----------|----------|\n")
        for c in candidates[:30]:
            param_str = str(c['param_size_b']) if c['param_size_b'] is not None else '—'
            f.write(f"| {c['rank']} | {c['model']} | {c['server_count']} | "
                    f"{c['quality_score']:.4f} | {c['writing']:.4f} | {c['coding']:.4f} | "
                    f"{c['tool_use']:.4f} | {param_str} |\n")
        if len(candidates) > 30:
            f.write(f"\n*... and {len(candidates) - 30} more candidates*\n")
        f.write(f"\n## Summary\n\n")
        f.write(f"- Total records: {total_records}\n")
        f.write(f"- Unique models before filter: {total_evaluated}\n")
        f.write(f"- Candidates after filter: {after_filter}\n")
    print(f"Wrote {OUT_MD}")

    print(f"\n=== Sanity Checks ===")
    print(f"Total candidates: {len(candidates)}")
    if len(candidates) < 25:
        print("WARNING: Fewer than 25 candidates!")

    top5 = candidates[:5]
    print("\nTop 5:")
    for c in top5:
        print(f"  {c['rank']}. {c['model']} (q={c['quality_score']}, srv={c['server_count']})")

    families = set()
    for c in top5:
        n = c['model'].lower()
        if n.startswith('qwen'): families.add('qwen')
        elif n.startswith('llama'): families.add('llama')
        elif n.startswith('mistral'): families.add('mistral')
        elif n.startswith('gemma'): families.add('gemma')
    print(f"Families in top 5: {families}")
    missing = {'qwen', 'llama', 'mistral', 'gemma'} - families
    if missing:
        print(f"WARNING: Missing families: {missing}")

    cloud_in_top5 = [c for c in top5 if is_cloud_model(c['model'])]
    print(f"Cloud models in top 5: {cloud_in_top5 or 'none'}")

    replacement_in_list = [c for c in candidates if is_replacement_target(c['model'])]
    print(f"Replacement targets in list: {replacement_in_list or 'none'}")

if __name__ == '__main__':
    main()
