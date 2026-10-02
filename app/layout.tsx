import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import "./industrial-precision.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "Mazmi Factory GMAO",
    template: "%s | Mazmi Factory GMAO",
  },
  description: "Gestión industrial de mantenimiento, activos y fiabilidad.",
  applicationName: "Mazmi Factory GMAO",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Mazmi Factory GMAO",
    description:
      "Complejidad industrial por debajo. Claridad extrema por encima.",
    type: "website",
    locale: "es_ES",
    images: [
      { url: "/og.png", width: 1733, height: 909, alt: "Mazmi Factory GMAO" },
    ],
  },
  twitter: {
    card: "summary",
    title: "Mazmi Factory GMAO",
    description: "Mantenimiento, activos y fiabilidad para la industria.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      lang="es"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.theme=localStorage.getItem('mazmi-theme')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
