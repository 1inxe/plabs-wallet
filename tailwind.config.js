/** @type {import('tailwindcss').Config} */
export default {
  content: ['./popup.html', './approval.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#111214',
        surface: '#1c1e21',
        raised: '#272a2e',
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
