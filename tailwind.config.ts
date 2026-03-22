import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm cream palette
        sand: {
          50: "#fefdfb",
          100: "#faf8f4",
          200: "#f0ebe3",
          300: "#e2ddd4",
          400: "#c0b9ab",
          500: "#969082",
          600: "#706b5f",
          700: "#504c43",
          800: "#383530",
          900: "#242220",
        },
        // Forest green accent
        accent: {
          DEFAULT: "#2d3a2e",
          light: "#4a6b4e",
          dark: "#1a2b1c",
          50: "#f0f5f0",
          100: "#dce8dc",
          200: "#b8d4b8",
          300: "#8bba8b",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        serif: [
          "var(--font-lora)",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "serif",
        ],
      },
      fontSize: {
        "display-lg": ["3.5rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "display": ["2.75rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "display-sm": ["2rem", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
      },
      borderRadius: {
        "xl": "0.875rem",
        "2xl": "1.25rem",
      },
      gridTemplateColumns: {
        "20": "repeat(20, minmax(0, 1fr))",
      },
      boxShadow: {
        "soft": "0 2px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -4px rgba(0, 0, 0, 0.03)",
        "soft-lg": "0 10px 40px -10px rgba(0, 0, 0, 0.08), 0 4px 12px -4px rgba(0, 0, 0, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
