import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
          950: "#082f49",
        },
        slate: {
          850: "#152033",
          950: "#0a0f1d",
        },
        automotive: {
          dark: "#0F172A",
          charcoal: "#1E293B",
          surface: "#F8FAFC",
          border: "#E2E8F0",
          accent: "#0284C7",
          success: "#059669",
          warning: "#D97706",
          danger: "#DC2626",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "var(--font-cairo)", "sans-serif"],
        arabic: ["var(--font-cairo)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
