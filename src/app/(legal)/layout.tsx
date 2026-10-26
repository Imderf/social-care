import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 leading-relaxed [&_a]:underline [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mb-1 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6">
      <Link href="/" className="mb-8 inline-block text-sm opacity-70">
        Ogilvy Social Care
      </Link>
      {children}
      <footer className="mt-12 border-t border-current/20 pt-4 text-sm opacity-70">
        Ogilvy &amp; Mather Colombia S.A.S. · Última actualización: 21 de octubre de 2026
      </footer>
    </main>
  );
}
