import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Marca Grupal (extraída del sitio) + shell oscuro para el logo blanco.
        brand: {
          blue: '#6EC1E4',
          'blue-ink': '#2A93C4',
          green: '#61CE70',
          'green-ink': '#2FA64A',
          gray: '#54595F',
        },
        // Shell oscuro (topbar/sidebar) — Swiss/minimal.
        shell: {
          900: '#0F141A',
          800: '#161D26',
          700: '#1F2935',
          600: '#2A3744',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,20,26,.04), 0 4px 16px rgba(16,20,26,.06)',
      },
      keyframes: {
        'scan-pulse': {
          '0%,100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'scan-pulse': 'scan-pulse 1.2s ease-in-out infinite',
        'fade-in': 'fade-in .2s ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
