/** @type {import('tailwindcss').Config} */
export default {
  content: ['./popup.html', './approval.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#101416',
        surface: '#1a2225',
        raised: '#242e31',
        line: '#344044',
        ink: '#f3f7f6',
        muted: '#9ca9a5',
        mint: '#14bb87',
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
