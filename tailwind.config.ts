import type { Config } from 'tailwindcss';

const config: Config = {
    content: [
        './app/**/*.{js,ts,jsx,tsx,mdx}',
        './components/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
        extend: {
            colors: {
                'tactical-black': '#000000',
                'tactical-red': '#FF1E27',
                'tactical-orange': '#FF5500',
                'tactical-yellow': '#FFE600',
                'tactical-white': '#FFFFFF',
            },
            fontSize: {
                xs: ['0.75rem', { lineHeight: '1rem' }],
                sm: ['0.875rem', { lineHeight: '1.25rem' }],
                base: ['1rem', { lineHeight: '1.5rem' }],
                lg: ['1.125rem', { lineHeight: '1.75rem' }],
            },
            keyframes: {
                pulse: {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0.5' },
                },
            },
            boxShadow: {
                'glow-red': '0 0 20px rgba(255, 30, 39, 0.6)',
                'glow-orange': '0 0 20px rgba(255, 85, 0, 0.6)',
                'glow-yellow': '0 0 20px rgba(255, 230, 0, 0.6)',
            },
        },
    },
    plugins: [],
};

export default config;
