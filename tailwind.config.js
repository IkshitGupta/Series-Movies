/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Required so the app can drive the color scheme manually (light/dark/system
  // toggle) on web via NativeWind's `setColorScheme`; harmless on native.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#E50914',
          dark: '#B20710',
        },
      },
    },
  },
  plugins: [],
};
