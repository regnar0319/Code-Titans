import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Laksha - Emergency Communication',
    description: 'Off-grid emergency communication system for mountainous regions',
    viewport: {
        width: 'device-width',
        initialScale: 1,
        maximumScale: 1,
        userScalable: false,
    },
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <head>
                <meta name="theme-color" content="#000000" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
            </head>
            <body className="bg-black text-white antialiased">
                {children}
            </body>
        </html>
    );
}
