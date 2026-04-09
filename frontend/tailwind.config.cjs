/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#0b1220',
        surface: '#0f1a2e',
        accent: '#22d3ee',
        neon: '#a78bfa',
      },
      boxShadow: {
        glow: '0 0 24px rgba(34,211,238,0.25)',
      },
    },
  },
  plugins: [],
}
