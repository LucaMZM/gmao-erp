import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="es" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('mazmi-theme');document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
