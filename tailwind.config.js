/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['views/**/*.liquid'],
  theme: {
    extend: {
      colors: {
        'twitch-purple': '#9146FF',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
