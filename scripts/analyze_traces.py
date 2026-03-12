"""
Step 7 — Trace Analyzer
Mines all JSON trace files in logs/traces/ to reveal:
  - Bug type distribution (how many of each)
  - Most common 5-action sequences before each bug type
  - Severity breakdown and unique session count per type

Usage:
    python scripts/analyze_traces.py
"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TRACES_DIR = ROOT / "logs" / "traces"


def load_traces(traces_dir: Path = TRACES_DIR):
    traces = []
    files = list(traces_dir.glob("*.json"))
    print(f"Found {len(files)} trace files in {traces_dir}")
    for f in files:
        try:
            with open(f, encoding="utf-8") as fp:
                traces.append(json.load(fp))
        except Exception as e:
            print(f"  ⚠ Could not read {f.name}: {e}")
    print(f"Loaded {len(traces)} valid traces\n")
    return traces


def analyze(traces: list):
    if not traces:
        print("No traces to analyse.")
        return

    # ── Group by bug type ────────────────────────────────────────────────────
    by_type: dict = {}
    severity_by_type: dict = {}
    sessions_by_type: dict = {}

    for t in traces:
        bug_type = t.get("bug_type") or t.get("type") or "unknown"
        by_type.setdefault(bug_type, []).append(t.get("actions", []))
        severity_by_type.setdefault(bug_type, []).append(
            t.get("severity", "unknown")
        )
        sessions_by_type.setdefault(bug_type, set()).add(
            t.get("session_id", "unknown")
        )

    # ── Distribution table ────────────────────────────────────────────────────
    print("=" * 60)
    print("📊  BUG TYPE DISTRIBUTION")
    print("=" * 60)
    print(f"{'Bug Type':<40} {'Count':>6}  {'Sessions':>8}  {'Severity'}")
    print("-" * 60)
    for bug_type, seqs in sorted(by_type.items(), key=lambda x: -len(x[1])):
        count = len(seqs)
        sessions = len(sessions_by_type[bug_type])
        severities = Counter(severity_by_type[bug_type])
        sev_str = ", ".join(f"{k}:{v}" for k, v in severities.items())
        print(f"{bug_type:<40} {count:>6}  {sessions:>8}  {sev_str}")

    # ── N-gram analysis ───────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("🔁  MOST COMMON 5-ACTION SEQUENCES BEFORE EACH BUG TYPE")
    print("=" * 60)
    for bug_type, seqs in sorted(by_type.items(), key=lambda x: -len(x[1])):
        ngrams: Counter = Counter()
        for seq in seqs:
            # Extract action integers (handle both plain ints and dicts with 'action' key)
            actions = []
            for item in seq:
                if isinstance(item, dict):
                    actions.append(item.get("action", item.get("keys", "?")))
                else:
                    actions.append(item)
            for i in range(len(actions) - 5):
                ngrams[tuple(actions[i : i + 5])] += 1

        print(f"\n  [{bug_type}] ({len(seqs)} occurrences)")
        if ngrams:
            for ngram, count in ngrams.most_common(3):
                print(f"    {list(ngram)}  →  {count}×")
        else:
            print("    (no action sequences recorded)")

    # ── Action frequency summary ──────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("🎮  OVERALL ACTION FREQUENCY IN ALL BUG TRACES")
    print("=" * 60)
    action_names = {
        0: "coast", 1: "accel", 2: "brake", 3: "left", 4: "right",
        5: "accel+left", 6: "accel+right", 7: "accel(dup)",
        8: "look_left", 9: "look_right", 10: "look_up", 11: "look_down",
    }
    all_actions: Counter = Counter()
    for seqs in by_type.values():
        for seq in seqs:
            for item in seq:
                a = item.get("action", item) if isinstance(item, dict) else item
                all_actions[a] += 1
    total = sum(all_actions.values()) or 1
    for action_id, cnt in sorted(all_actions.items(), key=lambda x: -x[1]):
        name = action_names.get(int(action_id), str(action_id))
        bar = "█" * int(30 * cnt / total)
        print(f"  {name:<14} ({action_id}): {cnt:>6}  {bar}")

    print("\n✅  Analysis complete.")


if __name__ == "__main__":
    traces = load_traces()
    analyze(traces)
