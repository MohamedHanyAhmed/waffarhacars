import QRCode from "qrcode";

/**
 * Generates a boolean 2D matrix representing a QR code for a given text string.
 * Backed by the audited, maintained 'qrcode' engine with error correction level M.
 *
 * Each element in the matrix represents a QR module:
 * true = dark module (#000000)
 * false = light module (#ffffff)
 */
export function generateQrMatrix(text: string): boolean[][] {
  if (!text || typeof text !== "string") {
    throw new Error("Text is required to generate QR matrix");
  }

  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const matrix: boolean[][] = [];

  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) {
      row.push(Boolean(qr.modules.get(r, c)));
    }
    matrix.push(row);
  }

  return matrix;
}
