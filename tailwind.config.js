/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./templates/**/*.html",
    "./static/js/**/*.js"
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Bricolage Grotesque', 'sans-serif'],
        body: ['Manrope', 'sans-serif'],
      },
      colors: {
        dusk: {
          900: '#08131f',
          800: '#0f2235',
          700: '#15304a',
        },
        surf: {
          400: '#50d8ff',
          300: '#7be3ff',
        },
        ember: {
          400: '#ff8b4a',
          300: '#ffac7a',
        },
      },
      boxShadow: {
        glow: '0 16px 50px rgba(80, 216, 255, 0.22)',
      },
    },
  },
  plugins: [],
}
