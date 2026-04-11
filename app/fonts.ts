import { IBM_Plex_Mono, Manrope, Outfit } from 'next/font/google';

export const fontHeading = Outfit({
  subsets: ['latin'],
  variable: '--font-space',
  display: 'swap',
});

export const fontBody = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const fontMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});
