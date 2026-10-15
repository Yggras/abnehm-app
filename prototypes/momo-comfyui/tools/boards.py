"""Baut aus der Auswahl (`selection.json`) die Vergleichstafeln.

Je Familie: Ankerformen, Silhouetten und eine Zeile in Momos Anzeigegröße (104 dp, Design-System
`momo-today`); dazu eine gemeinsame Silhouettentafel aller Familien. Kopiert die ausgewählten
Bilder (WebP) und ihre Laufprotokolle ins Repo.

Freistellung: Der Hintergrund ist einfarbig (`momo-stage` #DDF0EE). Pixel nahe der am Rand gemessenen
Hintergrundfarbe gelten als Hintergrund, kleine Splitter werden verworfen.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
from scipy import ndimage

import comfy

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = json.loads((ROOT / "prompts.json").read_text())
SELECTION = json.loads((ROOT / "selection.json").read_text())
FONT = Path(os.environ.get("MOMO_FONT", Path.home() / "personal/comfyui-momo/fonts/Rubik[wght].ttf"))

FORMS = {"hatchling": "Geschlüpft", "l13": "Level 13", "l26": "Level 26", "l43": "Level 43"}
SAND, CARD, STAGE, INK, MUTED, LINE = "#FBF4E6", "#FFFCF6", "#DDF0EE", "#1D3332", "#55625E", "#EAD9BC"
CELL, GAP, MARGIN, MOMO_TODAY = 420, 24, 48, 104


def font(size: int, weight: int = 400) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONT), size)
    f.set_variation_by_axes([weight])
    return f


def mask_of(img: Image.Image, tolerance: float = 28.0) -> np.ndarray:
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    border = np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3), a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    fg = np.linalg.norm(a - bg, axis=2) > tolerance
    fg = ndimage.binary_opening(fg, iterations=2)
    labels, n = ndimage.label(fg)
    sizes = ndimage.sum(fg, labels, range(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s > fg.size * 0.002]
    return np.isin(labels, keep)


def crop_square(img: Image.Image, mask: np.ndarray, pad: float = 0.08) -> tuple[Image.Image, Image.Image]:
    """Quadratischer Ausschnitt um die Figur; der leicht schwankende Generator-Hintergrund
    wird durch exakt `momo-stage` ersetzt, damit alle Tafeln denselben Grund haben."""
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    side = int(max(x1 - x0, y1 - y0) * (1 + 2 * pad))
    cx, cy = (x0 + x1) // 2 + side, (y0 + y1) // 2 + side
    box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
    sil = ImageOps.expand(Image.fromarray((mask * 255).astype(np.uint8)), border=side, fill=0)
    flat = Image.new("RGB", sil.size, STAGE)
    flat.paste(ImageOps.expand(img.convert("RGB"), border=side, fill=STAGE), mask=sil.filter(ImageFilter.GaussianBlur(1)))
    return flat.crop(box), sil.crop(box)


def silhouette(sil: Image.Image, size: int) -> Image.Image:
    out = Image.new("RGB", (size, size), "white")
    out.paste(Image.new("RGB", (size, size), "black"), mask=sil.resize((size, size), Image.LANCZOS))
    return out


def rounded(im: Image.Image, radius: int = 24) -> Image.Image:
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, *im.size), radius, fill=255)
    out = Image.new("RGBA", im.size)
    out.paste(im, mask=m)
    return out


def load_selected() -> dict[str, dict[str, tuple[Image.Image, Image.Image, dict]]]:
    out: dict[str, dict] = {}
    img_dir, run_dir = ROOT / "images", ROOT / "runs"
    img_dir.mkdir(exist_ok=True)
    run_dir.mkdir(exist_ok=True)
    for fam, forms in SELECTION["families"].items():
        out[fam] = {}
        for form, entry in forms.items():
            name, note = (entry, None) if isinstance(entry, str) else (entry["run"], entry.get("note"))
            src = comfy.RUNS / fam / f"{name}.png"
            record = json.loads(src.with_suffix(".json").read_text())
            if note:
                record["selection_note"] = note
            img = Image.open(src)
            rgb, sil = crop_square(img, mask_of(img))
            rgb.resize((640, 640), Image.LANCZOS).save(img_dir / f"{fam}-{form}.webp", quality=88, method=6)
            (run_dir / f"{fam}-{form}.json").write_text(json.dumps(record, indent=2, ensure_ascii=False))
            out[fam][form] = (rgb, sil, record)
    return out


def weights(record: dict) -> str:
    return "bf16" if "bf16" in record["api_graph"]["unet"]["inputs"]["unet_name"] else "int8"


def family_board(fam: str, forms: dict) -> Image.Image:
    meta = PROMPTS["families"][fam]
    width = MARGIN * 2 + 4 * CELL + 3 * GAP
    top, sil_size = 196, 200
    sil_y = top + CELL + 96
    small_y = sil_y + sil_size + 72
    height = small_y + MOMO_TODAY + 110
    board = Image.new("RGB", (width, height), SAND)
    d = ImageDraw.Draw(board)
    d.text((MARGIN, 40), f"Familie {fam} · {meta['name']}", font=font(44, 600), fill=INK)
    d.text((MARGIN, 100), meta["body_plan"], font=font(22, 500), fill=MUTED)
    d.text((MARGIN, 134), f"konstant: {meta['constants'][0]}; {meta['constants'][1]}", font=font(22), fill=MUTED)
    d.text((MARGIN, sil_y - 34), "Silhouette", font=font(18, 500), fill=MUTED)
    d.text((MARGIN, small_y - 34), "In Anzeigegröße: 104 px (momo-today bei 1×)", font=font(18, 500), fill=MUTED)
    for i, (form, label) in enumerate(FORMS.items()):
        rgb, sil, _ = forms[form]
        x = MARGIN + i * (CELL + GAP)
        card = rounded(rgb.resize((CELL, CELL), Image.LANCZOS))
        board.paste(card, (x, top), card)
        d.text((x, top + CELL + 12), label, font=font(24, 600), fill=INK)
        s = rounded(silhouette(sil, sil_size), 16)
        board.paste(s, (x + (CELL - sil_size) // 2, sil_y), s)
        small = rounded(rgb.resize((MOMO_TODAY, MOMO_TODAY), Image.LANCZOS), 12)
        board.paste(small, (x + (CELL - MOMO_TODAY) // 2, small_y), small)
    d.line((MARGIN, height - 72, width - MARGIN, height - 72), fill=LINE, width=2)
    def run_label(f: str) -> str:
        r = forms[f][2]
        note = f" ({r['selection_note']})" if r.get("selection_note") else ""
        return f"{FORMS[f]} s{r['seed']} {weights(r)}{note}"

    runs = " · ".join(run_label(f) for f in FORMS)
    d.text((MARGIN, height - 56), f"Entwurf, nicht verbindlich · ComfyUI 0.40.0 · Qwen-Image-2.1 Turbo · {runs}", font=font(18), fill=MUTED)
    return board


def silhouette_board(data: dict) -> Image.Image:
    size, label_w = 260, 340
    width = MARGIN * 2 + label_w + 4 * size + 3 * GAP
    height = 150 + len(data) * (size + GAP) + 40
    board = Image.new("RGB", (width, height), "white")
    d = ImageDraw.Draw(board)
    d.text((MARGIN, 40), "Silhouetten aller Familien", font=font(40, 600), fill="black")
    for i, label in enumerate(FORMS.values()):
        d.text((MARGIN + label_w + i * (size + GAP), 110), label, font=font(22, 600), fill="black")
    for r, (fam, forms) in enumerate(data.items()):
        y = 150 + r * (size + GAP)
        d.text((MARGIN, y + size // 2 - 30), f"{fam} · {PROMPTS['families'][fam]['name']}", font=font(24, 600), fill="black")
        d.multiline_text((MARGIN, y + size // 2 + 4), PROMPTS["families"][fam]["body_plan"].replace(", ", ",\n"), font=font(17), fill="#444444", spacing=4)
        for i, form in enumerate(FORMS):
            board.paste(silhouette(forms[form][1], size), (MARGIN + label_w + i * (size + GAP), y))
    return board


def main() -> None:
    data = load_selected()
    out = ROOT / "boards"
    out.mkdir(exist_ok=True)
    for fam, forms in data.items():
        family_board(fam, forms).save(out / f"familie-{fam.lower()}.webp", quality=90, method=6)
    silhouette_board(data).save(out / "silhouetten.webp", quality=90, method=6)
    print("ok", out)


if __name__ == "__main__":
    main()
