# Theme subject extraction

`ThemeExtractor.swift` is a macOS-only offline candidate generator for the ten
non-classic themes. It reads `themes.json`, runs Apple Vision foreground-instance
detection on each complete source sheet, restores the original premultiplied RGBA
edge pixels with alpha connected components, and writes reviewable candidate output.
It does not replace files below `assets/skins` by default.

## Build

Requires macOS 14 or newer and Xcode command-line tools:

```sh
xcrun swiftc -parse-as-library \
  -framework Vision -framework CoreImage -framework ImageIO \
  scripts/theme-extraction/ThemeExtractor.swift \
  -o /tmp/theme-extractor
```

## Run one theme

Run from the repository root:

```sh
/tmp/theme-extractor \
  --config scripts/theme-extraction/themes.json \
  --theme music
```

Use `--theme all` for all configured themes. By default each run is written to:

```text
scripts/theme-extraction/runs/<timestamp>/<theme-id>/
  slots/                         10 independent 400x400 transparent PNGs
  <configured sprite filename>   2000x800, 5x2 candidate sheet
  contact-sheet-numbered.png     checkerboard review sheet numbered 0...9
  candidate-map.png              Vision/alpha candidate boxes and IDs
  report.json                    mapping, bounds, margin, and review status
```

The `runs/` directory contains generated review artifacts and is ignored by Git.
Only reviewed final sprite sheets belong under `assets/skins/`.

An explicit candidate directory can be used during testing:

```sh
/tmp/theme-extractor \
  --config scripts/theme-extraction/themes.json \
  --theme music \
  --output /tmp/theme-extraction-review
```

Existing run directories are refused unless `--force` is present. Output below
`assets/skins` is additionally refused unless the path is explicit and
`--allow-assets-output` is supplied. Those switches only disable safety guards;
they do not make a candidate reviewed or approved.

## Candidate overrides

Automatic mapping uses the center of each declared 5x2 slot. Candidate IDs are
shown in `candidate-map.png` and `report.json`:

- `V<n>`: a Vision foreground instance.
- `A<n>`: an original-alpha connected component.

Optional fields can be added to an individual slot in a review configuration:

```json
{
  "index": 5,
  "nameZh": "吉他",
  "safeFilename": "05-guitar.png",
  "candidates": ["V6", "A6", "A11"],
  "expectedCenter": [0.1, 0.75],
  "scale": 0.96,
  "offsetX": 0,
  "offsetY": -4
}
```

`candidates` may contain multiple instances/components, which is useful for
detached drumsticks, fireworks, rain, petals, or a kite tail. `instanceIDs` and
`componentIDs` are equivalent numeric shortcuts. Explicit mappings are strict:
missing candidate IDs make that slot require review.

The optional slot `scale` is an extraction-only adjustment and is capped so the
24-pixel alpha safety margin cannot be violated. The theme-level `scale` in
`themes.json` records the runtime baseline and is intentionally not applied
during normalization, avoiding double scaling.

## Result interpretation

Exit status `0` means every slot is non-empty and respects the 24-pixel safety
margin. Exit status `2` means candidate artifacts were produced but one or more
slots require manual review. A passing report is necessary but not sufficient for
promotion: inspect the numbered contact sheet for missing detached details,
incorrect subjects, soft/aliased outlines, and visual centering first.
