import { describe, it, expect } from "vitest";
import { generateQrMatrix } from "@/lib/qr/qr-code";

describe("QR Code Matrix Generator Unit Tests", () => {
  it("generates a square boolean matrix for a standard TOTP URI", () => {
    const totpURI =
      "otpauth://totp/WaffarhaCars:admin@waffarhacars.com?secret=JBSWY3DPEHPK3PXP&issuer=WaffarhaCars&digits=6&period=30";
    const matrix = generateQrMatrix(totpURI);

    expect(matrix).toBeDefined();
    expect(matrix.length).toBeGreaterThan(0);
    // Square matrix
    expect(matrix.length).toBe(matrix[0].length);
    // Size should be a valid QR version size (e.g. 45, 49, 53, etc.)
    expect((matrix.length - 21) % 4).toBe(0);
  });

  it("contains standard finder patterns at top-left, top-right, and bottom-left", () => {
    const matrix = generateQrMatrix("otpauth://totp/Test?secret=ABCDEF");
    const size = matrix.length;

    // Center of 7x7 finder pattern is at (3, 3) relative to corner and must be black (true)
    // Top-left finder center: (3, 3)
    expect(matrix[3][3]).toBe(true);
    // Top-right finder center: (3, size - 4)
    expect(matrix[3][size - 4]).toBe(true);
    // Bottom-left finder center: (size - 4, 3)
    expect(matrix[size - 4][3]).toBe(true);
  });
});
