import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
    title: 'PR•ORBIT - Offline Emergency Communication',
    description: 'Internet-independent emergency communication platform',
    // Keep title, description, icons, etc. here
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    themeColor: '#0f172a', // Move any themeColor or scale properties here
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}