import type { Config } from 'tailwindcss'

export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            maxWidth: {
                content: 'var(--content-max-w, 960px)'
            },
            fontFamily: {
                sans: ['var(--font-sans)'],
                mono: ['var(--font-mono)']
            }
        }
    },
    plugins: []
} satisfies Config

