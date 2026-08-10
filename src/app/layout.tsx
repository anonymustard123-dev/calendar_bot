import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Calendar Client Filter | BNY',
  description: 'Identify upcoming external client meetings from iCalendar files.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
