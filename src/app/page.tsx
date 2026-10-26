import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-og-red">Ogilvy Colombia</p>
      <h1 className="font-serif text-5xl leading-tight md:text-6xl">Ogilvy Social Care</h1>
      <p className="max-w-xl text-lg text-og-grey-700">
        Herramienta de Ogilvy Colombia para que las marcas respondan los comentarios y mensajes que reciben en Facebook e
        Instagram.
      </p>
      <div>
        <Link href="/panel" className="inline-block bg-og-black px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-white hover:bg-og-red">
          Entrar al panel
        </Link>
      </div>
      <nav className="mt-6 flex flex-wrap gap-4 border-t border-og-black pt-4 text-sm underline">
        <Link href="/privacidad">Política de privacidad</Link>
        <Link href="/terminos">Términos del servicio</Link>
        <Link href="/eliminacion-de-datos">Eliminación de datos</Link>
      </nav>
    </main>
  );
}
