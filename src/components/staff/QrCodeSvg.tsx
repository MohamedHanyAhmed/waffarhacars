"use client";

import React, { useMemo } from "react";
import { generateQrMatrix } from "@/lib/qr/qr-code";

interface QrCodeSvgProps {
  value: string;
  size?: number;
  className?: string;
}

export function QrCodeSvg({ value, size = 200, className = "" }: QrCodeSvgProps) {
  const matrix = useMemo(() => {
    try {
      return generateQrMatrix(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-100 text-slate-400 text-xs text-center p-4 rounded-lg border border-slate-200 ${className}`}
        style={{ width: size, height: size }}
      >
        QR unavailable
      </div>
    );
  }

  const moduleCount = matrix.length;
  const padding = 4;
  const viewBoxSize = moduleCount + padding * 2;

  return (
    <svg
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      width={size}
      height={size}
      className={`bg-white p-2 rounded-xl border border-slate-200 shadow-inner ${className}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR Code for TOTP Setup"
    >
      <rect width={viewBoxSize} height={viewBoxSize} fill="#ffffff" />
      {matrix.map((row, r) =>
        row.map((isDark, c) => {
          if (!isDark) return null;
          return (
            <rect
              key={`${r}-${c}`}
              x={c + padding}
              y={r + padding}
              width={1}
              height={1}
              fill="#0f172a"
            />
          );
        })
      )}
    </svg>
  );
}
