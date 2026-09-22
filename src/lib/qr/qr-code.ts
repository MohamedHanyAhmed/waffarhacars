/**
 * Zero-dependency QR Code Generator (Model 2, Byte Mode, EC Level M)
 * Generates boolean[][] matrix suitable for rendering SVG/Canvas.
 */

// GF(256) math with primitive polynomial 0x11D (285)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return EXP[LOG[x] + LOG[y]];
}

function rsGenPoly(n: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < n; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsCompute(data: Uint8Array, ecLength: number): Uint8Array {
  const gen = rsGenPoly(ecLength);
  const remainder = new Uint8Array(ecLength);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    for (let i = 0; i < ecLength - 1; i++) {
      remainder[i] = remainder[i + 1] ^ gfMul(gen[i], factor);
    }
    remainder[ecLength - 1] = gfMul(gen[ecLength - 1], factor);
  }
  return remainder;
}

// Version table for EC Level M (Version 1 to 10)
interface VersionSpec {
  version: number;
  size: number;
  totalCodewords: number;
  ecPerBlock: number;
  blocks: number;
  dataCapacity: number;
  alignPos: number[];
}

const VERSIONS: VersionSpec[] = [
  {
    version: 1,
    size: 21,
    totalCodewords: 26,
    ecPerBlock: 10,
    blocks: 1,
    dataCapacity: 14,
    alignPos: [],
  },
  {
    version: 2,
    size: 25,
    totalCodewords: 44,
    ecPerBlock: 16,
    blocks: 1,
    dataCapacity: 26,
    alignPos: [6, 18],
  },
  {
    version: 3,
    size: 29,
    totalCodewords: 70,
    ecPerBlock: 26,
    blocks: 1,
    dataCapacity: 42,
    alignPos: [6, 22],
  },
  {
    version: 4,
    size: 33,
    totalCodewords: 100,
    ecPerBlock: 18,
    blocks: 2,
    dataCapacity: 62,
    alignPos: [6, 26],
  },
  {
    version: 5,
    size: 37,
    totalCodewords: 134,
    ecPerBlock: 24,
    blocks: 2,
    dataCapacity: 84,
    alignPos: [6, 30],
  },
  {
    version: 6,
    size: 41,
    totalCodewords: 172,
    ecPerBlock: 16,
    blocks: 4,
    dataCapacity: 106,
    alignPos: [6, 34],
  },
  {
    version: 7,
    size: 45,
    totalCodewords: 196,
    ecPerBlock: 18,
    blocks: 4,
    dataCapacity: 122,
    alignPos: [6, 22, 38],
  },
  {
    version: 8,
    size: 49,
    totalCodewords: 242,
    ecPerBlock: 22,
    blocks: 4,
    dataCapacity: 152,
    alignPos: [6, 24, 42],
  },
  {
    version: 9,
    size: 53,
    totalCodewords: 292,
    ecPerBlock: 22,
    blocks: 5,
    dataCapacity: 180,
    alignPos: [6, 26, 46],
  },
  {
    version: 10,
    size: 57,
    totalCodewords: 346,
    ecPerBlock: 26,
    blocks: 5,
    dataCapacity: 213,
    alignPos: [6, 28, 50],
  },
];

export function generateQrMatrix(text: string): boolean[][] {
  const textBytes = new TextEncoder().encode(text);
  const dataLen = textBytes.length;

  const spec = VERSIONS.find((v) => {
    const headerBits = 4 + (v.version < 10 ? 8 : 16);
    return dataLen * 8 + headerBits <= v.dataCapacity * 8;
  });

  if (!spec) {
    throw new Error(`Data too long for QR generator: ${dataLen} bytes`);
  }

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  // 1. Mode indicator (0100 for byte)
  pushBits(0b0100, 4);

  // 2. Character count
  pushBits(dataLen, spec.version < 10 ? 8 : 16);

  // 3. Data bytes
  for (const b of textBytes) {
    pushBits(b, 8);
  }

  // 4. Terminator
  const maxBits = spec.dataCapacity * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  pushBits(0, termLen);

  // 5. Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // 6. Pad bytes
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < maxBits) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  const dataCodewords = new Uint8Array(spec.dataCapacity);
  for (let i = 0; i < spec.dataCapacity; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i * 8 + j];
    }
    dataCodewords[i] = byte;
  }

  const blocksCount = spec.blocks;
  const ecPerBlock = spec.ecPerBlock;
  const shortBlockLen = Math.floor(spec.dataCapacity / blocksCount);
  const longBlocksCount = spec.dataCapacity % blocksCount;
  const shortBlocksCount = blocksCount - longBlocksCount;

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];

  let offset = 0;
  for (let b = 0; b < blocksCount; b++) {
    const bLen = b < shortBlocksCount ? shortBlockLen : shortBlockLen + 1;
    const slice = dataCodewords.slice(offset, offset + bLen);
    offset += bLen;
    dataBlocks.push(slice);
    ecBlocks.push(rsCompute(slice, ecPerBlock));
  }

  const interleaved: number[] = [];
  const maxDataBlockLen = shortBlockLen + (longBlocksCount > 0 ? 1 : 0);
  for (let i = 0; i < maxDataBlockLen; i++) {
    for (let b = 0; b < blocksCount; b++) {
      if (i < dataBlocks[b].length) {
        interleaved.push(dataBlocks[b][i]);
      }
    }
  }

  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < blocksCount; b++) {
      interleaved.push(ecBlocks[b][i]);
    }
  }

  const finalBits: number[] = [];
  for (const byte of interleaved) {
    for (let i = 7; i >= 0; i--) {
      finalBits.push((byte >> i) & 1);
    }
  }

  const size = spec.size;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null)
  );
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false)
  );

  const setFunc = (r: number, c: number, val: boolean) => {
    matrix[r][c] = val;
    isFunction[r][c] = true;
  };

  const placeFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        if (
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          setFunc(nr, nc, true);
        } else {
          setFunc(nr, nc, false);
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  const pos = spec.alignPos;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const r = pos[i];
      const c = pos[j];
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === pos.length - 1) ||
        (i === pos.length - 1 && j === 0)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const isBlack = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setFunc(r + dr, c + dc, isBlack);
        }
      }
    }
  }

  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isFunction[8][i] = true;
      isFunction[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFunction[8][size - 1 - i] = true;
    isFunction[size - 1 - i][8] = true;
  }
  setFunc(size - 8, 8, true);

  let bitIdx = 0;
  let right = size - 1;
  let upward = true;

  while (right > 0) {
    if (right === 6) right--;
    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const r of rows) {
      for (const c of [right, right - 1]) {
        if (!isFunction[r][c]) {
          const bit = bitIdx < finalBits.length ? finalBits[bitIdx++] : 0;
          const mask = (r + c) % 2 === 0;
          matrix[r][c] = (bit === 1) !== mask;
        }
      }
    }
    upward = !upward;
    right -= 2;
  }

  const formatBits = 0x5412;
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >> (14 - i)) & 1) === 1;
    if (i < 6) matrix[8][i] = bit;
    else if (i === 6) matrix[8][7] = bit;
    else if (i === 7) matrix[8][8] = bit;
    else if (i === 8) matrix[7][8] = bit;
    else matrix[14 - i][8] = bit;

    if (i < 8) {
      matrix[size - 1 - i][8] = bit;
    } else {
      matrix[8][size - 15 + i] = bit;
    }
  }

  return matrix.map((row) => row.map((cell) => cell === true));
}
