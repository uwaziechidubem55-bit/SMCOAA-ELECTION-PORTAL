/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#341D61',
        navy: '#341D61',
        accent: '#50347B',
      }
    },
  },
  plugins: [],
}