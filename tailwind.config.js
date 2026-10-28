/** @type {import('tailwindcss').Config} */
export default {
  content: ['./popup.html', './approval.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#0c0c0e',
        surface: '#19191c',
        raised: '#202024',
        line: '#303035',
        ink: '#f3f3f5',
        muted: '#909096',
        mint: '#b4ebcd',
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
