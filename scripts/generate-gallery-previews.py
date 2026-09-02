#!/usr/bin/env python3
"""Generate the approved 128px / 128-color gallery assets; never board art.

Offline dependency: Pillow 12.3.0. See docs/corridor-preview-assets.md.
Node reads the existing CommonJS registries so this tool has no theme ID list.
"""

import argparse
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SIZE = 128
COLORS = 128
MAX_BYTES = 8 * 1024


def local_path(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(f"Invalid local asset path: {value!r}")
    path = Path(value)
    if path.is_absolute() or any(part in (".", "..") for part in value.split("/")):
        raise ValueError(f"Invalid local asset path: {value}")
    resolved = (ROOT / path).resolve()
    if not resolved.is_relative_to(ROOT):
        raise ValueError(f"Asset escapes project: {value}")
    return resolved


def manifests():
    query = """
const themes = require('./src/skins/index.js').filter(theme => theme.id !== 'classic');
const effects = require('./src/effects/index.js').filter(effect => effect.preview);
process.stdout.write(JSON.stringify({themes, effects}));
"""
    result = subprocess.run(["node", "-e", query], cwd=ROOT, check=True,
                            capture_output=True, text=True)
    return json.loads(result.stdout)


def source_image(path):
    with Image.open(path) as image:
        return image.convert("RGBA")


def theme_preview(theme):
    visuals = theme.get("tileVisuals", {})
    if (visuals.get("columns"), visuals.get("rows"), visuals.get("count")) != (5, 2, 10):
        raise ValueError(f"{theme['id']}: expected the existing 5x2 / 10-slot board contract")
    source = source_image(local_path(theme["assets"]["tileSheet"]))
    if source.size != (2000, 800):
        raise ValueError(f"{theme['id']}: source must be the formal 2000x800 sheet")
    preview = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    cell = SIZE // 2
    for index in range(4):
        frame = source.crop((index * 400, 0, (index + 1) * 400, 400))
        frame = frame.resize((cell, cell), Image.Resampling.LANCZOS)
        # Faint resampling halos must not become visible after quantization.
        frame.paste((0, 0, 0, 0), (0, 0, cell, 2))
        frame.paste((0, 0, 0, 0), (0, cell - 2, cell, cell))
        frame.paste((0, 0, 0, 0), (0, 0, 2, cell))
        frame.paste((0, 0, 0, 0), (cell - 2, 0, cell, cell))
        # No mask: pasting with the image as its mask would apply alpha twice.
        preview.paste(frame, ((index % 2) * cell, (index // 2) * cell))
    return preview


def encode(image):
    preview = image.quantize(colors=COLORS, method=Image.Quantize.FASTOCTREE,
                             dither=Image.Dither.NONE)
    preview.info.clear()
    output = io.BytesIO()
    preview.save(output, format="PNG", bits=8, optimize=True, compress_level=9)
    data = output.getvalue()
    with Image.open(io.BytesIO(data)) as checked:
        if checked.size != (SIZE, SIZE) or checked.mode != "P":
            raise ValueError("Preview must be a 128x128 indexed PNG")
        if len(checked.convert("RGBA").getcolors(SIZE * SIZE)) > COLORS:
            raise ValueError("Preview exceeds 128 RGBA colors")
        alpha = checked.convert("RGBA").getchannel("A")
        if alpha.getextrema()[0] != 0 or alpha.getextrema()[1] <= 8:
            raise ValueError("Preview must retain transparent and visible pixels")
    if len(data) > MAX_BYTES:
        raise ValueError(f"Preview exceeds 8 KiB ({len(data)} bytes); revise art, not the approved spec")
    return data


def generate():
    registry = manifests()
    outputs = {}
    for kind, entries in registry.items():
        for entry in entries:
            identifier = entry["id"]
            if not isinstance(identifier, str) or not re.fullmatch(r"[a-z0-9_-]+", identifier):
                raise ValueError(f"Invalid manifest id: {identifier!r}")
            expected = (f"assets/theme-previews/{identifier}.png" if kind == "themes"
                        else f"assets/effects/{identifier}/preview.png")
            if entry.get("preview") != expected:
                raise ValueError(f"{identifier}: declare preview: '{expected}'")
            target = local_path(expected)
            if target in outputs:
                raise ValueError(f"Duplicate preview output: {expected}")
            if kind == "themes":
                image = theme_preview(entry)
            else:
                source = local_path(f"scripts/gallery-preview-sources/effects/{identifier}.png")
                image = ImageOps.pad(source_image(source), (SIZE, SIZE),
                                     method=Image.Resampling.LANCZOS, color=(0, 0, 0, 0))
            outputs[target] = encode(image)
    return outputs


def write_image(target, data):
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".preview-", suffix=".png", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare regenerated bytes; do not write files")
    args = parser.parse_args()
    # Build and validate every result before changing any published image.
    outputs = generate()
    stale = [str(path.relative_to(ROOT)) for path, data in outputs.items()
             if not path.is_file() or path.read_bytes() != data]
    if args.check and stale:
        raise ValueError("Previews require regeneration: " + ", ".join(stale))
    for target, data in outputs.items():
        if not args.check and (not target.is_file() or target.read_bytes() != data):
            write_image(target, data)
        print(f"PASS {target.relative_to(ROOT)}: {len(data)} bytes")
    print(f"{'Checked' if args.check else 'Generated'} {len(outputs)} previews, "
          f"{sum(map(len, outputs.values()))} bytes total")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"ERROR: {error}") from error
