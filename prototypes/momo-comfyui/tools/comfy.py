"""Kleiner Client für die lokale ComfyUI-Server-API (POST /prompt, /history, /view, /upload/image).

Baut die beiden flachen API-Graphen aus `workflows/` mit konkreten Werten,
schickt sie ab, wartet auf das Ergebnis und legt Bild plus Protokoll ab.
Rohgenerierungen landen außerhalb des Repos (Standard: ~/personal/comfyui-momo/runs).
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
WORKFLOWS = HERE.parent / "workflows"
SERVER = os.environ.get("COMFY_SERVER", "http://127.0.0.1:8188")
RUNS = Path(os.environ.get("MOMO_RUNS", Path.home() / "personal/comfyui-momo/runs"))
UNET = os.environ.get("MOMO_UNET")  # z. B. qwen_image_2.1_turbo_bf16.safetensors statt der int8-Vorgabe


def load_workflow(name: str) -> dict:
    g = json.loads((WORKFLOWS / f"{name}.api.json").read_text())
    if UNET:
        g["unet"]["inputs"]["unet_name"] = UNET
    return g


def upload(path: Path) -> str:
    """Lädt ein Referenzbild in den input-Ordner von ComfyUI und gibt den Dateinamen zurück."""
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    name = f"momo_{digest}{path.suffix}"
    with path.open("rb") as f:
        r = requests.post(f"{SERVER}/upload/image", files={"image": (name, f)}, data={"overwrite": "true"})
    r.raise_for_status()
    return r.json()["name"]


def t2i_graph(prompt: str, seed: int, width: int, height: int, prefix: str) -> dict:
    g = load_workflow("t2i")
    g["prompt"]["inputs"]["prompt"] = prompt
    g["noise"]["inputs"]["noise_seed"] = seed
    g["latent"]["inputs"].update(width=width, height=height)
    g["save"]["inputs"]["filename_prefix"] = prefix
    return g


def edit_graph(prompt: str, seed: int, refs: list[str], prefix: str, size: tuple[int, int] | None) -> dict:
    """Referenz-Edit: `refs[0]` ist image_1. Ohne `size` übernimmt die Leinwand image_1
    (offizieller Edit-Pfad); mit `size` wird ein leeres Latent dieser Größe gesampelt
    (Vorlage `custom_size`), damit sich Körperbau und Silhouette stärker lösen dürfen."""
    g = load_workflow("edit")
    enc = g["prompt"]["inputs"]
    enc["prompt"] = prompt
    for i, ref in enumerate(refs, start=1):
        node = f"ref_{i}"
        g[node] = {"class_type": "LoadImage", "inputs": {"image": ref}}
        enc[f"images.image_{i}"] = [node, 0]
    g["noise"]["inputs"]["noise_seed"] = seed
    if size:
        g["latent"] = {"class_type": "EmptyLatentImage", "inputs": {"width": size[0], "height": size[1], "batch_size": 1}}
        g["sampler"]["inputs"]["latent_image"] = ["latent", 0]
    g["save"]["inputs"]["filename_prefix"] = prefix
    return g


def run(graph: dict, out_dir: Path, name: str, meta: dict, timeout: float = 4 * 3600) -> Path:
    """Schickt einen API-Graphen ab, wartet auf das Bild und speichert Bild plus Protokoll."""
    out_dir.mkdir(parents=True, exist_ok=True)
    client_id = str(uuid.uuid4())
    started = time.time()
    r = requests.post(f"{SERVER}/prompt", json={"prompt": graph, "client_id": client_id})
    if r.status_code != 200:
        raise RuntimeError(f"/prompt {r.status_code}: {r.text}")
    prompt_id = r.json()["prompt_id"]
    while True:
        h = requests.get(f"{SERVER}/history/{prompt_id}").json()
        if prompt_id in h:
            entry = h[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(json.dumps(status.get("messages"), indent=1)[:4000])
            if status.get("completed"):
                break
        if time.time() - started > timeout:
            raise TimeoutError(prompt_id)
        time.sleep(1)
    stamps = {m[0]: m[1]["timestamp"] for m in status.get("messages", []) if "timestamp" in m[1]}
    seconds = round((stamps["execution_success"] - stamps["execution_start"]) / 1000, 1)
    images = [img for out in entry["outputs"].values() for img in out.get("images", [])]
    img = images[0]
    data = requests.get(f"{SERVER}/view", params={"filename": img["filename"], "subfolder": img["subfolder"], "type": img["type"]}).content
    target = out_dir / f"{name}.png"
    target.write_bytes(data)
    record = {
        "name": name,
        "file": target.name,
        "sha256": hashlib.sha256(data).hexdigest(),
        "seconds_execution": seconds,
        "prompt_id": prompt_id,
        **meta,
        "api_graph": graph,
    }
    (out_dir / f"{name}.json").write_text(json.dumps(record, indent=2, ensure_ascii=False))
    return target
