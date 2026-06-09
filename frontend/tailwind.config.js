/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#f0f4ff",
          100: "#e0e9ff",
          500: "#3b67f8",
          600: "#2a55e5",
          700: "#1e43cc",
        },
      },
    },
  },
  plugins: [],
};
