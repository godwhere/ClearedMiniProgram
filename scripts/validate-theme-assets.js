#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const EXPECTED_WIDTH = 2000;
const EXPECTED_HEIGHT = 800;
const COLUMNS = 5;
const ROWS = 2;
const SLOT_COUNT = COLUMNS * ROWS;
const SAFE_MARGIN = 24;
const ALPHA_THRESHOLD = 8;

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crcTable[n] = value >>> 0;
  }
  return crcTable;
}

function crc32(parts) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      crc = table[(crc ^ part[index]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function channelsForColorType(colorType) {
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 3: return 1;
    case 4: return 2;
    case 6: return 4;
    default: throw new Error(`unsupported PNG color type ${colorType}`);
  }
}

function validateBitDepth(colorType, bitDepth) {
  const allowed = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  };
  if (!allowed[colorType] || allowed[colorType].indexOf(bitDepth) < 0) {
    throw new Error(`unsupported bit depth ${bitDepth} for PNG color type ${colorType}`);
  }
}

function readSample(row, sampleIndex, bitDepth) {
  if (bitDepth === 8) return row[sampleIndex];
  if (bitDepth === 16) return row.readUInt16BE(sampleIndex * 2);
  const bitOffset = sampleIndex * bitDepth;
  const byte = row[bitOffset >>> 3];
  const shift = 8 - bitDepth - (bitOffset & 7);
  return (byte >>> shift) & ((1 << bitDepth) - 1);
}

function sampleToByte(sample, bitDepth) {
  if (bitDepth === 8) return sample;
  if (bitDepth === 16) return sample >>> 8;
  return Math.round(sample * 255 / ((1 << bitDepth) - 1));
}

function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('PNG input must be a Buffer');
  if (buffer.length < PNG_SIGNATURE.length ||
      !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('invalid PNG signature');
  }

  let offset = PNG_SIGNATURE.length;
  let ihdr = null;
  let palette = null;
  let transparency = null;
  let sawIend = false;
  const idatParts = [];

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error('truncated PNG chunk header');
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) throw new Error('truncated PNG chunk data');

    const typeBuffer = buffer.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32([typeBuffer, data]);
    if (actualCrc !== expectedCrc) throw new Error(`CRC mismatch in ${type} chunk`);

    if (!ihdr && type !== 'IHDR') throw new Error('IHDR must be the first PNG chunk');
    if (type === 'IHDR') {
      if (ihdr) throw new Error('duplicate IHDR chunk');
      if (length !== 13) throw new Error('IHDR chunk must contain 13 bytes');
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12]
      };
      if (!ihdr.width || !ihdr.height) throw new Error('PNG dimensions must be positive');
      if (ihdr.compression !== 0 || ihdr.filter !== 0) {
        throw new Error('unsupported PNG compression or filter method');
      }
      if (ihdr.interlace !== 0) throw new Error('interlaced PNGs are not supported');
      validateBitDepth(ihdr.colorType, ihdr.bitDepth);
    } else if (type === 'PLTE') {
      if (length === 0 || length % 3 !== 0 || length > 768) throw new Error('invalid PLTE chunk');
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data);
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error('IEND chunk must be empty');
      sawIend = true;
      offset = chunkEnd;
      break;
    } else if ((typeBuffer[0] & 0x20) === 0) {
      throw new Error(`unsupported critical PNG chunk ${type}`);
    }
    offset = chunkEnd;
  }

  if (!ihdr) throw new Error('missing IHDR chunk');
  if (!sawIend) throw new Error('missing IEND chunk');
  if (!idatParts.length) throw new Error('missing IDAT chunk');
  if (ihdr.colorType === 3 && !palette) throw new Error('indexed PNG is missing PLTE chunk');

  const channels = channelsForColorType(ihdr.colorType);
  const bitsPerPixel = channels * ihdr.bitDepth;
  const rowBytes = Math.ceil(ihdr.width * bitsPerPixel / 8);
  const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(idatParts));
  } catch (error) {
    throw new Error(`cannot inflate PNG image data: ${error.message}`);
  }
  const expectedInflatedLength = (rowBytes + 1) * ihdr.height;
  if (inflated.length !== expectedInflatedLength) {
    throw new Error(`decoded image data has ${inflated.length} bytes; expected ${expectedInflatedLength}`);
  }

  const scanlines = Buffer.allocUnsafe(rowBytes * ihdr.height);
  for (let y = 0; y < ihdr.height; y += 1) {
    const inputStart = y * (rowBytes + 1);
    const outputStart = y * rowBytes;
    const filterType = inflated[inputStart];
    if (filterType > 4) throw new Error(`invalid PNG filter type ${filterType} on row ${y}`);
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[inputStart + 1 + x];
      const left = x >= filterBytesPerPixel ? scanlines[outputStart + x - filterBytesPerPixel] : 0;
      const above = y > 0 ? scanlines[outputStart - rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= filterBytesPerPixel
        ? scanlines[outputStart - rowBytes + x - filterBytesPerPixel]
        : 0;
      let value;
      switch (filterType) {
        case 0: value = raw; break;
        case 1: value = raw + left; break;
        case 2: value = raw + above; break;
        case 3: value = raw + Math.floor((left + above) / 2); break;
        case 4: value = raw + paethPredictor(left, above, upperLeft); break;
        default: value = raw;
      }
      scanlines[outputStart + x] = value & 0xff;
    }
  }

  const rgba = Buffer.allocUnsafe(ihdr.width * ihdr.height * 4);
  let outputOffset = 0;
  for (let y = 0; y < ihdr.height; y += 1) {
    const row = scanlines.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < ihdr.width; x += 1) {
      const sampleIndex = x * channels;
      let red;
      let green;
      let blue;
      let alpha = 255;
      if (ihdr.colorType === 0) {
        const graySample = readSample(row, sampleIndex, ihdr.bitDepth);
        red = green = blue = sampleToByte(graySample, ihdr.bitDepth);
        if (transparency && transparency.length >= 2 && graySample === transparency.readUInt16BE(0)) alpha = 0;
      } else if (ihdr.colorType === 2) {
        const redSample = readSample(row, sampleIndex, ihdr.bitDepth);
        const greenSample = readSample(row, sampleIndex + 1, ihdr.bitDepth);
        const blueSample = readSample(row, sampleIndex + 2, ihdr.bitDepth);
        red = sampleToByte(redSample, ihdr.bitDepth);
        green = sampleToByte(greenSample, ihdr.bitDepth);
        blue = sampleToByte(blueSample, ihdr.bitDepth);
        if (transparency && transparency.length >= 6 &&
            redSample === transparency.readUInt16BE(0) &&
            greenSample === transparency.readUInt16BE(2) &&
            blueSample === transparency.readUInt16BE(4)) alpha = 0;
      } else if (ihdr.colorType === 3) {
        const paletteIndex = readSample(row, sampleIndex, ihdr.bitDepth);
        const paletteOffset = paletteIndex * 3;
        if (paletteOffset + 2 >= palette.length) throw new Error(`palette index ${paletteIndex} is out of range`);
        red = palette[paletteOffset];
        green = palette[paletteOffset + 1];
        blue = palette[paletteOffset + 2];
        alpha = transparency && paletteIndex < transparency.length ? transparency[paletteIndex] : 255;
      } else if (ihdr.colorType === 4) {
        const graySample = readSample(row, sampleIndex, ihdr.bitDepth);
        red = green = blue = sampleToByte(graySample, ihdr.bitDepth);
        alpha = sampleToByte(readSample(row, sampleIndex + 1, ihdr.bitDepth), ihdr.bitDepth);
      } else {
        red = sampleToByte(readSample(row, sampleIndex, ihdr.bitDepth), ihdr.bitDepth);
        green = sampleToByte(readSample(row, sampleIndex + 1, ihdr.bitDepth), ihdr.bitDepth);
        blue = sampleToByte(readSample(row, sampleIndex + 2, ihdr.bitDepth), ihdr.bitDepth);
        alpha = sampleToByte(readSample(row, sampleIndex + 3, ihdr.bitDepth), ihdr.bitDepth);
      }
      rgba[outputOffset] = red;
      rgba[outputOffset + 1] = green;
      rgba[outputOffset + 2] = blue;
      rgba[outputOffset + 3] = alpha;
      outputOffset += 4;
    }
  }

  return Object.assign({}, ihdr, { rgba });
}

function alphaAt(image, x, y) {
  return image.rgba[(y * image.width + x) * 4 + 3];
}

function analyzeThemeImage(image) {
  const issues = [];
  if (image.width !== EXPECTED_WIDTH || image.height !== EXPECTED_HEIGHT) {
    issues.push(`size ${image.width}x${image.height} (expected ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT})`);
  }
  if (image.width % COLUMNS !== 0 || image.height % ROWS !== 0) {
    issues.push(`not divisible by ${COLUMNS}x${ROWS}`);
  }
  const logicalCellWidth = image.width / COLUMNS;
  const logicalCellHeight = image.height / ROWS;
  if (logicalCellWidth !== logicalCellHeight) {
    issues.push(`non-square cells ${logicalCellWidth.toFixed(2)}x${logicalCellHeight.toFixed(2)}`);
  }

  const xBounds = Array.from({ length: COLUMNS + 1 }, (_, index) => Math.round(index * image.width / COLUMNS));
  const yBounds = Array.from({ length: ROWS + 1 }, (_, index) => Math.round(index * image.height / ROWS));
  const slots = [];
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const column = slot % COLUMNS;
    const row = Math.floor(slot / COLUMNS);
    const x0 = xBounds[column];
    const x1 = xBounds[column + 1];
    const y0 = yBounds[row];
    const y1 = yBounds[row + 1];
    let minX = x1;
    let minY = y1;
    let maxX = -1;
    let maxY = -1;
    let opaquePixels = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (alphaAt(image, x, y) <= ALPHA_THRESHOLD) continue;
        opaquePixels += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!opaquePixels) {
      slots.push({ slot, empty: true, opaquePixels: 0 });
      continue;
    }
    const margins = {
      left: minX - x0,
      top: minY - y0,
      right: x1 - 1 - maxX,
      bottom: y1 - 1 - maxY
    };
    slots.push({
      slot,
      empty: false,
      opaquePixels,
      bbox: { minX, minY, maxX, maxY },
      margins,
      minMargin: Math.min(margins.left, margins.top, margins.right, margins.bottom)
    });
  }

  const emptySlots = slots.filter(slot => slot.empty).map(slot => slot.slot);
  const unsafeSlots = slots.filter(slot => !slot.empty && slot.minMargin < SAFE_MARGIN);
  if (emptySlots.length) issues.push(`empty slots ${emptySlots.join(',')}`);
  if (unsafeSlots.length) {
    issues.push(`unsafe slots ${unsafeSlots.map(slot => `${slot.slot}:${slot.minMargin}px`).join(',')}`);
  }

  const gridViolations = [];
  for (let column = 1; column < COLUMNS; column += 1) {
    const line = image.width * column / COLUMNS;
    const start = Math.max(0, Math.ceil(line - SAFE_MARGIN));
    const end = Math.min(image.width, Math.ceil(line + SAFE_MARGIN));
    let count = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = start; x < end; x += 1) {
        if (alphaAt(image, x, y) > ALPHA_THRESHOLD) count += 1;
      }
    }
    if (count) gridViolations.push({ axis: 'v', line: column, pixels: count });
  }
  for (let row = 1; row < ROWS; row += 1) {
    const line = image.height * row / ROWS;
    const start = Math.max(0, Math.ceil(line - SAFE_MARGIN));
    const end = Math.min(image.height, Math.ceil(line + SAFE_MARGIN));
    let count = 0;
    for (let y = start; y < end; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (alphaAt(image, x, y) > ALPHA_THRESHOLD) count += 1;
      }
    }
    if (count) gridViolations.push({ axis: 'h', line: row, pixels: count });
  }
  if (gridViolations.length) {
    issues.push(`grid alpha ${gridViolations.map(item => `${item.axis}${item.line}:${item.pixels}`).join(',')}`);
  }

  const populatedSlots = SLOT_COUNT - emptySlots.length;
  const populatedMargins = slots.filter(slot => !slot.empty).map(slot => slot.minMargin);
  return {
    issues,
    slots,
    populatedSlots,
    unsafeSlots,
    gridViolations,
    minMargin: populatedMargins.length ? Math.min.apply(null, populatedMargins) : null
  };
}

function collectPngFiles(inputs, defaultScan) {
  const found = [];
  function visit(target, explicit) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (defaultScan && entry.isDirectory() && entry.name === 'drafts') continue;
        visit(path.join(target, entry.name), false);
      }
    } else if (stat.isFile() && /\.png$/i.test(target) &&
               (explicit || !defaultScan || /-sprite-sheet\.png$/i.test(target))) {
      found.push(path.resolve(target));
    }
  }
  for (const input of inputs) visit(path.resolve(input), true);
  return Array.from(new Set(found)).sort();
}

function relativeName(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  return relative.startsWith('..') ? filePath : relative;
}

function formatAnalysis(filePath, image, analysis, auditOld) {
  const status = auditOld ? 'AUDIT' : (analysis.issues.length ? 'FAIL' : 'PASS');
  const margin = analysis.minMargin === null ? 'n/a' : `${analysis.minMargin}px`;
  const base = `[${status}] ${relativeName(filePath)} ${image.width}x${image.height}` +
    ` | slots ${analysis.populatedSlots}/${SLOT_COUNT} | min-edge ${margin}`;
  if (!analysis.issues.length) return `${base} | grid clear`;
  return `${base} | ${analysis.issues.join('; ')}`;
}

function validateFile(filePath) {
  const image = decodePng(fs.readFileSync(filePath));
  return { image, analysis: analyzeThemeImage(image) };
}

function usage() {
  return [
    'Usage: node scripts/validate-theme-assets.js [--audit-old] [PNG_OR_DIRECTORY ...]',
    '',
    'Without paths, validates assets/skins/*/*-sprite-sheet.png.',
    '--audit-old reports legacy geometry/safety findings without failing on them.'
  ].join('\n');
}

function runCli(argv) {
  let auditOld = false;
  const inputs = [];
  for (const argument of argv) {
    if (argument === '--audit-old') auditOld = true;
    else if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${usage()}\n`);
      return 0;
    } else if (argument.startsWith('-')) {
      process.stderr.write(`Unknown option: ${argument}\n${usage()}\n`);
      return 2;
    } else inputs.push(argument);
  }

  const defaultScan = inputs.length === 0;
  const targets = defaultScan ? [path.join(process.cwd(), 'assets', 'skins')] : inputs;
  let files;
  try {
    files = collectPngFiles(targets, defaultScan);
  } catch (error) {
    process.stderr.write(`[ERROR] ${error.message}\n`);
    return 1;
  }
  if (!files.length) {
    process.stderr.write('[ERROR] no PNG files found\n');
    return 1;
  }

  let invalid = 0;
  let reported = 0;
  let unreadable = 0;
  for (const filePath of files) {
    try {
      const result = validateFile(filePath);
      process.stdout.write(`${formatAnalysis(filePath, result.image, result.analysis, auditOld)}\n`);
      if (result.analysis.issues.length) reported += 1;
      if (!auditOld && result.analysis.issues.length) invalid += 1;
    } catch (error) {
      unreadable += 1;
      process.stderr.write(`[ERROR] ${relativeName(filePath)} | ${error.message}\n`);
    }
  }
  const findings = invalid + unreadable;
  if (auditOld) {
    process.stdout.write(`audit: ${files.length} file(s), ${reported} with findings, ${unreadable} unreadable\n`);
  } else {
    process.stdout.write(`validation: ${files.length} file(s), ${invalid} invalid, ${unreadable} unreadable\n`);
  }
  return findings ? 1 : 0;
}

module.exports = {
  ALPHA_THRESHOLD,
  COLUMNS,
  EXPECTED_HEIGHT,
  EXPECTED_WIDTH,
  ROWS,
  SAFE_MARGIN,
  SLOT_COUNT,
  analyzeThemeImage,
  decodePng,
  validateFile
};

if (require.main === module) process.exitCode = runCli(process.argv.slice(2));
