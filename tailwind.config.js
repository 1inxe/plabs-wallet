/** @type {import('tailwindcss').Config} */
export default {
  content: ['./popup.html', './approval.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#101419',
        surface: '#181c21',
        raised: '#1c2025',
        line: '#29352f',
        ink: '#e0e2ea',
        muted: '#bbcabf',
        mint: '#4edea3',
        amber: '#ffb95f',
        danger: '#ff7885',
      },
      boxShadow: {
        panel: '0 18px 70px rgba(0, 0, 0, 0.48)',
      },
    },
  },
  plugins: [],
};
