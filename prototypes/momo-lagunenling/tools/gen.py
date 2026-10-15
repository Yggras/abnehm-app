"""Erzeugt Runde 2 für Momos Gestalt (#69): den Lagunenling als Formenkette, Stimmungen, Ei und Accessoires.

  gen.py f1 f2 --seed 601          Jobs der Reihe nach ausführen
  gen.py mood:f1:freut acc:f4:seestern+halstuch
  gen.py egg-a acc-sheet --seed 611

Jobs:
  f1                    Stilbereinigung der in #72 gewählten Grundform (selection.json → source)
  f2 … f8b              Referenz-Edit der vorigen Form (f8a/f8b beide aus f7)
  mood:<form>:<mood>    nur Gesicht und Ärmchen ändern
  fix:<job>:<fix>       lokale Korrektur eines gewählten Laufs (prompts.json → fixes)
  acc:<form>:<a>+<b>    Accessoires aus prompts.json ergänzen
  egg-a, egg-b, …       Text-zu-Bild aus prompts.json → t2i

Vorlagen werden über selection.json aufgelöst (Job → gewählter Lauf). Rohbilder und Protokolle landen
in $MOMO_RUNS/B2/ (Standard ~/personal/comfyui-momo/runs/B2). Der ComfyUI-Client stammt aus #72.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT.parent / "momo-comfyui" / "tools"))
import comfy  # noqa: E402

PROMPTS = json.loads((ROOT / "prompts.json").read_text())
SELECTION = ROOT / "selection.json"
OUT = comfy.RUNS / "B2"
CHAIN = ["f1", "f2", "f3", "f4", "f5", "f6", "f7"]


USE: dict[str, str] = {}  # --use JOB=LAUF überschreibt selection.json für diesen Aufruf


def resolve(job: str) -> Path:
    """Gewählter Lauf eines Jobs (oder `source`) als Bilddatei."""
    picked = USE.get(job) or json.loads(SELECTION.read_text())[job]
    path = Path(picked).expanduser()
    return path if path.is_absolute() else OUT / f"{picked}.png"


def plan(job: str) -> tuple[str, list[str], str]:
    """(mode, Vorlagen-Jobs, Prompt) eines Jobs."""
    if job == "f1":
        return "edit", ["source"], PROMPTS["normalize"]
    if job in PROMPTS["forms"]:
        prev = "f7" if job.startswith("f8") else CHAIN[CHAIN.index(job) - 1]
        return "edit", [prev], PROMPTS["evolve"].format(change=PROMPTS["forms"][job]["change"])
    if job.startswith("mood:"):
        _, form, mood = job.split(":")
        m, no_limbs = PROMPTS["moods"][mood], PROMPTS["forms"][form].get("no_limbs")
        prompt = PROMPTS["mood"].format(mood=m.get("prompt_no_limbs", m["prompt"]) if no_limbs else m["prompt"])
        if no_limbs:
            prompt += " " + PROMPTS["mood_no_limbs"]
        return "edit", [form], prompt
    if job.startswith("fix:"):
        _, target, fix = job.split(":")
        return "edit", [target], PROMPTS["fixes"][fix]
    if job.startswith("acc:"):
        _, form, ids = job.split(":")
        items = " and ".join(PROMPTS["accessories"][i]["prompt"] for i in ids.split("+"))
        return "edit", [form], PROMPTS["accessory"].format(items=items)
    return "t2i", [], PROMPTS["t2i"][job]


def run(job: str, seed: int, size: int, tag: str) -> Path:
    mode, ref_jobs, prompt = plan(job)
    name = f"{job.replace(':', '-').replace('+', '-')}-s{seed}{tag}"
    meta: dict = {"mode": mode, "job": job, "seed": seed, "prompt": prompt}
    if mode == "t2i":
        graph = comfy.t2i_graph(prompt, seed, size, size, f"momo69/{name}")
    else:
        refs = [resolve(r) for r in ref_jobs]
        graph = comfy.edit_graph(prompt, seed, [comfy.upload(r) for r in refs], f"momo69/{name}", None)
        meta["references"] = [
            {"job": j, "file": r.name, "sha256": hashlib.sha256(r.read_bytes()).hexdigest()} for j, r in zip(ref_jobs, refs)
        ]
    return comfy.run(graph, OUT, name, meta)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("jobs", nargs="+")
    p.add_argument("--seed", type=int, default=601)
    p.add_argument("--size", type=int, default=768)
    p.add_argument("--tag", default="")
    p.add_argument("--use", action="append", default=[], help="JOB=LAUF, z. B. f3=fix-f3-color-s607")
    args = p.parse_args()
    USE.update(u.split("=", 1) for u in args.use)
    for job in args.jobs:
        print(run(job, args.seed, args.size, args.tag), flush=True)


if __name__ == "__main__":
    main()
