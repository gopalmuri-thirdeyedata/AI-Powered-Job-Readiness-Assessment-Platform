/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        primary: "#5d8c2c", // Brand Green (legacy token preserved)
        brandEmerald: "#059669", // Canonical Brand Emerald
        actionBlue: "#00AEEF",
        rrBg: "#F7F9FC",
        rrDarkBg: "#0B1220",
        rrCard: "#FFFFFF",
        rrDarkCard: "#111B2E",
        rrBorder: "#E2E8F0",
        rrDarkBorder: "#1E293B",
      },
    },
  },
  plugins: [],
}
