/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0B0D12',
        surface: {
          DEFAULT: '#12151C',
          2: '#181C25',
        },
        line: '#232836',
        'text-base': '#E8EAF0',
        'text-dim': '#8A92A6',
        accent: {
          DEFAULT: '#7C8CFF',
          hover: '#6878F5',
        },
        ok: '#4ADE9A',
        warn: '#F5B35A',
        bad: '#FF6B6B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        card: '14px',
        btn: '10px',
      },
      fontSize: {
        'hero': ['48px', { lineHeight: '1.1' }],
        'display': ['28px', { lineHeight: '1.2' }],
        'heading': ['20px', { lineHeight: '1.3' }],
        'body': ['16px', { lineHeight: '1.5' }],
        'caption': ['14px', { lineHeight: '1.4' }],
        'tiny': ['12px', { lineHeight: '1.3' }],
      },
    },
  },
  plugins: [],
}
