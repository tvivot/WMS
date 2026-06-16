import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta REAL del sitio grupaldistribuidora.com.ar (kit Elementor).
        brand: {
          blue: '#6EC1E4', //       --e-global-color-primary  (celeste, fills/acentos)
          'blue-ink': '#1E7BA8', // celeste oscurecido → contraste AA para texto/links/focus sobre blanco
          green: '#61CE70', //      --e-global-color-accent   (verde, indicadores/fills)
          'green-ink': '#16803C', // verde oscurecido → contraste AA para botón con texto blanco
          navy: '#334F98', //       azul profundo de marca (íconos sociales / color custom del kit)
          gray: '#54595F', //       --e-global-color-secondary
          'gray-text': '#7A7A7A', // --e-global-color-text
        },
        // Shell (topbar/sidebar/login): rampa centrada en el navy REAL de marca (#334F98),
        // el mismo tono del header del sitio grupaldistribuidora.com.ar. Logo blanco encima.
        shell: {
          900: '#334F98', // navy de marca → chrome (header, login, panel de ayuda)
          800: '#2B4381', // un punto más profundo → botones primarios / chips sólidos
          700: '#3D5FB6', // más claro → hover de botón (feedback)
          600: '#5072C4', // el más claro → fills/acentos decorativos
        },
      },
      fontFamily: {
        // Cuerpo = Fira Sans (fuente real del sitio); títulos/nav = Jost (la del header de Grupal).
        sans: ['"Fira Sans"', 'system-ui', 'sans-serif'],
        display: ['Jost', '"Fira Sans"', 'system-ui', 'sans-serif'],
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
