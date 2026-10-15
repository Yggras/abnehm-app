"""Baut aus selection.json die Tafeln von Runde 2 und kopiert die gewählten Bilder und Protokolle ins Repo.

Tafeln: Formenkette (alle acht Formen mit Silhouette, 104 px auf „Heute“ und ≈ 40 px auf einem Inselfeld),
Stimmungen, Ei, Accessoires. Freistellung und Hilfsfunktionen stammen aus den Tafeln von #72.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT.parent / "momo-comfyui" / "tools"))
from boards import CARD, GAP, INK, LINE, MARGIN, MOMO_TODAY, MUTED, SAND, crop_square, font, mask_of, rounded, silhouette  # noqa: E402

from gen import OUT, PROMPTS  # noqa: E402

SELECTION = json.loads((ROOT / "selection.json").read_text())
ISLAND_MOMO = 40  # ≈ ein Feld hoch auf der Insel bei Zoom 1 (island-tile 64 × 32 dp), eigene Annäherung
FOOTER = "Entwurf, nicht verbindlich · ComfyUI 0.40.0 · Qwen-Image-2.1 Turbo int8 · Prompts, Seeds und Graphen in runs/"


def load(job: str, crop: bool = True) -> tuple[Image.Image, Image.Image | None]:
    """Gewähltes Bild; `crop=False` lässt Sammelbilder ungeschnitten, weil die Freistellung blasse Einzelteile verwirft."""
    name = SELECTION[job]
    src = OUT / f"{name}.png"
    img = Image.open(src)
    rgb, sil = crop_square(img, mask_of(img)) if crop else (img.convert("RGB"), None)
    slug = job.replace(":", "-").replace("+", "-")
    (ROOT / "images").mkdir(exist_ok=True)
    (ROOT / "runs").mkdir(exist_ok=True)
    rgb.resize((640, 640), Image.LANCZOS).save(ROOT / "images" / f"{slug}.webp", quality=88, method=6)
    (ROOT / "runs" / f"{slug}.json").write_text(src.with_suffix(".json").read_text())
    return rgb, sil


def canvas(cols: int, cell: int, rows_height: int, title: str, subtitle: str) -> tuple[Image.Image, ImageDraw.ImageDraw, int]:
    width = max(MARGIN * 2 + cols * cell + (cols - 1) * GAP, 1180)
    height = 150 + rows_height + 90
    board = Image.new("RGB", (width, height), SAND)
    d = ImageDraw.Draw(board)
    d.text((MARGIN, 36), title, font=font(42, 600), fill=INK)
    d.text((MARGIN, 94), subtitle, font=font(21), fill=MUTED)
    d.line((MARGIN, height - 66, width - MARGIN, height - 66), fill=LINE, width=2)
    d.text((MARGIN, height - 50), FOOTER, font=font(17), fill=MUTED)
    return board, d, 150


def wrap(text: str, f, width: int) -> str:
    """Bricht `text` so um, dass jede Zeile in `width` Pixel passt."""
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if line and f.getlength(trial) > width:
            lines.append(line)
            line = word
        else:
            line = trial
    return "\n".join(lines + [line])


def card(board: Image.Image, rgb: Image.Image, x: int, y: int, size: int, radius: int = 22) -> None:
    c = rounded(rgb.resize((size, size), Image.LANCZOS), radius)
    board.paste(c, (x, y), c)


def forms_board(forms: list[str]) -> Image.Image:
    cell, cols = 300, 5
    rows = (len(forms) + cols - 1) // cols
    block = cell + 44 + 120 + 80
    board, d, top = canvas(cols, cell, rows * block, "Lagunenling · Formenkette",
                           "konstant: je drei Kiemenwedel in Koralle, cremefarbener Bauchstreifen vom Kinn bis zur Schwanzspitze; Flossen in Koralle statt Türkis")
    label_font, desc_font = font(21, 600), font(16)
    for i, job in enumerate(forms):
        meta = PROMPTS["forms"][job]
        rgb, sil = load(job)
        x = MARGIN + (i % cols) * (cell + GAP)
        y = top + (i // cols) * block
        card(board, rgb, x, y, cell)
        d.text((x, y + cell + 8), f"Level {meta['level']} · {meta['name']}", font=label_font, fill=INK)
        sy = y + cell + 44
        s = rounded(silhouette(sil, 120), 12)
        board.paste(s, (x, sy), s)
        card(board, rgb, x + 120 + 16, sy, MOMO_TODAY, 12)
        card(board, rgb, x + 120 + 16 + MOMO_TODAY + 16, sy + MOMO_TODAY - ISLAND_MOMO, ISLAND_MOMO, 6)
        d.multiline_text((x, sy + 128), wrap(meta["body_plan"], desc_font, cell), font=desc_font, fill=MUTED, spacing=3)
    d.text((MARGIN, 120), "je Form: Silhouette · 104 px (momo-today bei 1×) · 40 px (≈ ein Inselfeld hoch)", font=font(17, 500), fill=MUTED)
    return board


def grid_board(title: str, subtitle: str, rows: list[tuple[str, list[tuple[str, str]]]], cell: int = 260, extra: int = 0) -> Image.Image:
    """Zeilen aus (Zeilentitel, [(Job, Beschriftung), …]) mit 104-px-Vorschau unter jeder Zelle."""
    cols = max(len(r[1]) for r in rows)
    label_font = font(19, 500)
    block = 40 + cell + 66 + MOMO_TODAY + 28
    board, d, top = canvas(cols, cell, len(rows) * block + extra, title, subtitle)
    for r, (row_title, cells) in enumerate(rows):
        y = top + r * block
        d.text((MARGIN, y), row_title, font=font(22, 600), fill=INK)
        for c, (job, label) in enumerate(cells):
            rgb, _ = load(job)
            x = MARGIN + c * (cell + GAP)
            card(board, rgb, x, y + 40, cell)
            d.multiline_text((x, y + 40 + cell + 8), wrap(label, label_font, cell), font=label_font, fill=INK, spacing=2)
            card(board, rgb, x + (cell - MOMO_TODAY) // 2, y + 40 + cell + 62, MOMO_TODAY, 12)
    return board


def accessory_board(on_figure: list[tuple[str, str]]) -> Image.Image:
    """Accessoire-Proben auf der Figur, darunter die ungeschnittene Katalogskizze mit Namensliste."""
    sheet = 520
    board = grid_board("Lagunenling · Accessoires", "sitzen am Kopf oder Hals, verdecken nie das Gesicht (#28)",
                       [("auf der Figur (Kopf + Hals)", on_figure)], extra=40 + sheet + 24)
    d = ImageDraw.Draw(board)
    y = 150 + 40 + 260 + 66 + MOMO_TODAY + 28
    d.text((MARGIN, y), "Katalogskizze: zwölf Kandidaten", font=font(22, 600), fill=INK)
    rgb, _ = load("acc-sheet", crop=False)
    card(board, rgb, MARGIN, y + 40, sheet)
    x = MARGIN + sheet + 48
    for col, (title, items) in enumerate((("Kopf", HEAD_ITEMS), ("Hals", NECK_ITEMS))):
        d.text((x + col * 260, y + 40), title, font=font(20, 600), fill=INK)
        d.multiline_text((x + col * 260, y + 74), "\n".join(items), font=font(19), fill=MUTED, spacing=10)
    return board


# Reihenfolge wie im Prompt der Katalogskizze (prompts.json → t2i → acc-sheet)
HEAD_ITEMS = ["Strohhütchen", "Seestern-Spange", "Hibiskusblüte", "Seerosenblatt-Hut", "Blütenkranz", "Haarschleife"]
NECK_ITEMS = ["Muschelkette", "Halstuch", "Blumenkette", "Fliege", "Perlenkette", "Strickschal"]


def main() -> None:
    out = ROOT / "boards"
    out.mkdir(exist_ok=True)
    forms = [j for j in PROMPTS["forms"] if j in SELECTION]
    forms_board(forms).save(out / "formen.webp", quality=90, method=6)

    mood_rows = []
    for form, meta in PROMPTS["forms"].items():
        cells = [(f"mood:{form}:{m}", v["name"]) for m, v in PROMPTS["moods"].items() if f"mood:{form}:{m}" in SELECTION]
        if cells:
            mood_rows.append((f"Level {meta['level']} · {meta['name']}", [(form, "zufrieden"), *cells]))
    if mood_rows:
        grid_board("Lagunenling · Stimmungen", "nie traurig, krank, hungrig oder strafend; „wartet im Ei“ auf der Ei-Tafel", mood_rows, 240).save(out / "stimmungen.webp", quality=90, method=6)

    egg_labels = {"egg-a": "A · Ei mit Tupfen", "egg-b": "B · Laichkugel"}
    eggs = [(j, egg_labels[j]) for j in egg_labels if j in SELECTION]
    if eggs:
        grid_board("Lagunenling · Ei", "Momo wartet ohne Kopplung im Ei (#14)", [("Varianten", eggs)]).save(out / "ei.webp", quality=90, method=6)

    def acc_label(job: str) -> str:
        _, form, ids = job.split(":")
        items = " + ".join(PROMPTS["accessories"][a]["name"] for a in ids.split("+"))
        return f"L{PROMPTS['forms'][form]['level']}{form[2:]}: {items}"

    accs = [(j, acc_label(j)) for j in SELECTION if j.startswith("acc:")]
    if accs and "acc-sheet" in SELECTION:
        accessory_board(accs).save(out / "accessoires.webp", quality=90, method=6)
    print("ok", out)


if __name__ == "__main__":
    main()
