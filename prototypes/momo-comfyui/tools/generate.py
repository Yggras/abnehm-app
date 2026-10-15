"""Erzeugt Momo-Konzeptbilder über die lokale ComfyUI-API.

  explore A --seeds 11 12 13          Text-zu-Bild einer Form (Standard: geschlüpft) mit mehreren Seeds
  evolve A l13 --ref a.png --seed 21   Referenz-Edit: Vorform als <image1> → nächste Ankerform

Jeder Lauf schreibt `<name>.png` und `<name>.json` (Prompt, Seed, Referenzen, Laufzeit, API-Graph)
nach $MOMO_RUNS/<Familie>/.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import comfy

PROMPTS = json.loads((Path(__file__).resolve().parent.parent / "prompts.json").read_text())
STAGE = {"hatchling": "newborn", "l13": "young", "l26": "adult", "l43": "elder"}


def t2i_prompt(family: str, form: str) -> str:
    fam = PROMPTS["families"][family]
    return " ".join([
        f"A creature design: {fam['forms'][form]}.",
        f"Signature features: {fam['constants_en']}.",
        PROMPTS["style"],
        PROMPTS["framing"],
    ])


def evolve_prompt(family: str, from_form: str, form: str) -> str:
    """Kurze Änderungsanweisung: Lange Stilblöcke ließen das Edit-Modell nur die Haltung ändern."""
    fam = PROMPTS["families"][family]
    return PROMPTS["evolve"].format(
        from_stage=STAGE[from_form], stage=STAGE[form], change=fam["changes"][form], constants=fam["constants_en"]
    )


def explore(args: argparse.Namespace) -> None:
    prompt = t2i_prompt(args.family, args.form)
    for seed in args.seeds:
        name = f"{args.family}-{args.form}-t2i-s{seed}"
        graph = comfy.t2i_graph(prompt, seed, args.size, args.size, f"momo/{name}")
        meta = {"mode": "t2i", "family": args.family, "form": args.form, "seed": seed, "prompt": prompt}
        path = comfy.run(graph, comfy.RUNS / args.family, name, meta)
        print(path, flush=True)


def evolve(args: argparse.Namespace) -> None:
    refs = [Path(r).resolve() for r in args.ref]
    uploaded = [comfy.upload(r) for r in refs]
    prompt = args.prompt or evolve_prompt(args.family, args.from_form, args.form)
    size = (args.size, args.size) if args.fresh_latent else None
    for seed in args.seeds:
        name = f"{args.family}-{args.form}-{'ref' if args.fresh_latent else 'edit'}-s{seed}{args.tag}"
        graph = comfy.edit_graph(prompt, seed, uploaded, f"momo/{name}", size)
        meta = {
            "mode": "ref" if args.fresh_latent else "edit",
            "family": args.family,
            "form": args.form,
            "seed": seed,
            "prompt": prompt,
            "references": [{"file": r.name, "sha256": hashlib.sha256(r.read_bytes()).hexdigest()} for r in refs],
        }
        path = comfy.run(graph, comfy.RUNS / args.family, name, meta)
        print(path, flush=True)


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(required=True)

    e = sub.add_parser("explore")
    e.add_argument("family", choices=PROMPTS["families"].keys())
    e.add_argument("--form", default="hatchling", choices=STAGE.keys())
    e.add_argument("--seeds", type=int, nargs="+", required=True)
    e.add_argument("--size", type=int, default=1024)
    e.set_defaults(fn=explore)

    v = sub.add_parser("evolve")
    v.add_argument("family", choices=PROMPTS["families"].keys())
    v.add_argument("form", choices=list(STAGE), help="hatchling nur mit --prompt (lokale Korrektur der Grundform)")
    v.add_argument("--from-form", default=None, help="Stufe von <image1>; Standard: die vorige Ankerform")
    v.add_argument("--ref", action="append", required=True, help="Referenzbild; das erste wird <image1>")
    v.add_argument("--seeds", type=int, nargs="+", required=True)
    v.add_argument("--fresh-latent", action="store_true", help="leeres Latent statt Leinwand von <image1>")
    v.add_argument("--size", type=int, default=1024)
    v.add_argument("--prompt", default=None, help="eigener Edit-Prompt statt der Vorlage aus prompts.json")
    v.add_argument("--tag", default="")
    v.set_defaults(fn=evolve)

    args = p.parse_args()
    if args.fn is evolve and args.from_form is None and args.form != "hatchling":
        order = list(STAGE)
        args.from_form = order[order.index(args.form) - 1]
    if args.fn is evolve and args.form == "hatchling" and not args.prompt:
        p.error("hatchling braucht --prompt")
    args.fn(args)


if __name__ == "__main__":
    main()
