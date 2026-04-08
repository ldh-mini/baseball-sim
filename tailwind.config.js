/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./*.jsx",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          950: '#050816',
          900: '#0a0e27',
          800: '#0f1535',
          700: '#141937',
          600: '#1a2142',
          500: '#232d55',
          400: '#2d3968',
        },
        accent: {
          blue: '#3b82f6',
          purple: '#8b5cf6',
          cyan: '#06b6d4',
          pink: '#ec4899',
        },
        neon: {
          blue: '#60a5fa',
          purple: '#a78bfa',
        }
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-gradient': 'linear-gradient(135deg, #0a0e27 0%, #1a1145 50%, #0f1535 100%)',
        'card-gradient': 'linear-gradient(135deg, rgba(20,25,55,0.8) 0%, rgba(15,21,53,0.6) 100%)',
        'btn-gradient': 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
        'btn-gradient-hover': 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
        'accent-gradient': 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
      },
      boxShadow: {
        'glow-blue': '0 0 20px rgba(59,130,246,0.3)',
        'glow-purple': '0 0 20px rgba(139,92,246,0.3)',
        'glow-cyan': '0 0 15px rgba(6,182,212,0.2)',
        'card': '0 4px 24px rgba(0,0,0,0.3)',
        'card-hover': '0 8px 32px rgba(0,0,0,0.4)',
      },
      borderColor: {
        'glass': 'rgba(255,255,255,0.08)',
      }
    },
  },
  plugins: [],
}
