import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const sans = localFont({
  src: [
    { path: "./fonts/OgilvySans-Light.otf", weight: "300" },
    { path: "./fonts/OgilvySans-Regular.otf", weight: "400" },
    { path: "./fonts/OgilvySans-Bold.otf", weight: "700" },
  ],
  variable: "--font-ogilvy-sans",
});
const serif = localFont({ src: "./fonts/OgilvySerif-Regular.otf", variable: "--font-ogilvy-serif" });

export const metadata: Metadata = {
  title: "Ogilvy Social Care",
  description: "Atención de comentarios y mensajes de Facebook e Instagram para marcas clientes de Ogilvy.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${sans.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
