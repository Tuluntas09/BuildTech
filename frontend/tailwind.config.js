/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#1c1d30",
          100: "#23253d",
          200: "#2e3060",
          300: "#4547a8",
          400: "#818cf8",
          500: "#6366F1",
          600: "#818cf8",
          700: "#a5b4fc",
          800: "#c7d2fe",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'SF Mono'", "ui-monospace", "monospace"],
        ui:   ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
