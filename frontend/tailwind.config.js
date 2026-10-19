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
      keyframes: {
        'pw-float': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-12px)' } },
        'pw-blob': {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(30px,-24px) scale(1.08)' },
          '66%': { transform: 'translate(-24px,18px) scale(0.95)' },
        },
        'pw-shimmer': { '0%': { backgroundPosition: '0% 50%' }, '100%': { backgroundPosition: '200% 50%' } },
        'pw-scan': { '0%': { top: '0%' }, '100%': { top: '100%' } },
        'pw-marquee': { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        'pw-ping': { '0%': { transform: 'scale(1)', opacity: '0.6' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
      },
      animation: {
        'pw-float': 'pw-float 6s ease-in-out infinite',
        'pw-float-slow': 'pw-float 9s ease-in-out infinite',
        'pw-blob': 'pw-blob 16s ease-in-out infinite',
        'pw-shimmer': 'pw-shimmer 6s linear infinite',
        'pw-scan': 'pw-scan 2.8s linear infinite',
        'pw-marquee': 'pw-marquee 38s linear infinite',
        'pw-ping': 'pw-ping 2s cubic-bezier(0,0,0.2,1) infinite',
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
