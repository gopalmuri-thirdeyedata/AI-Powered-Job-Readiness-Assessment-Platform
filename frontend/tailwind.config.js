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
        sans: ['Montserrat', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: "#5d8c2c", // Brand Green
        actionBlue: "#00AEEF",
        rrBg: "#F7F9FC",
        rrDarkBg: "#0B1220",
        rrCard: "#FFFFFF",
        rrDarkCard: "#111B2E",
        rrBorder: "#E2E8F0",
        rrDarkBorder: "#1E293B",
        sky: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#00AEEF',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        // Global Brand Palette Overrides (Yellow-Green Mix #5d8c2c)
        green: {
          50: '#e6f9ec',
          100: '#c3f0d2',
          200: '#8be6b1',
          300: '#4fd18c',
          400: '#22c55e',
          500: '#16a34a',
          600: '#15803d',
          700: '#166534',
          800: '#14532d',
          900: '#052e16',
        },
        indigo: {
          50: '#f7fee7',
          100: '#ecfccb',
          200: '#d9f99d',
          300: '#bef264',
          400: '#a3e635',
          500: '#76B828',
          600: '#5d8c2c',
          700: '#4B7928',
          800: '#3f6212',
          900: '#365314',
        },
        // Removed blue, purple, teal overrides to avoid yellow/green tints
      },
    },
  },
  plugins: [],
}
