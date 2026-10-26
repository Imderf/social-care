"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";

// Ejemplos genéricos de lo que hace la plataforma con cada mensaje (no son datos de un cliente).
type Outcome = "ia" | "persona" | "oculta";
const EXAMPLES: { dm: boolean; channel: string; text: string; outcome: Outcome; label: string }[] = [
  { dm: false, channel: "Instagram · comentario", text: "¿Hasta qué hora abren hoy?", outcome: "ia", label: "Responde la IA con la plantilla de horarios" },
  { dm: true, channel: "Facebook · mensaje privado", text: "Mi pedido no ha llegado y ya pasaron tres días", outcome: "persona", label: "Pasa a una persona en la Bandeja" },
  { dm: false, channel: "Facebook · comentario", text: "Les dejo mi cédula y mi celular para que me llamen", outcome: "oculta", label: "Se oculta: trae datos personales" },
  { dm: false, channel: "Instagram · comentario", text: "😍💙", outcome: "ia", label: "Responde la IA con un agradecimiento" },
  { dm: true, channel: "Instagram · mensaje privado", text: "¿Tienen domicilio en Chía?", outcome: "ia", label: "Responde la IA con la base de conocimiento" },
  { dm: false, channel: "Facebook · comentario", text: "Gana dinero desde casa, entra a mi perfil", outcome: "oculta", label: "Se oculta: es spam" },
  { dm: false, channel: "Facebook · comentario", text: "Llevo una hora en la fila y nadie atiende", outcome: "persona", label: "Pasa a una persona: es una queja" },
  { dm: false, channel: "Instagram · comentario", text: "¿Cómo hago para cambiar un producto?", outcome: "ia", label: "Responde la IA con la plantilla de cambios" },
];
const DOT: Record<Outcome, string> = { ia: "bg-s1", persona: "bg-s2", oculta: "bg-s3" };
const SLOT = 124; // alto de cada tarjeta + separación
const SHIFT = 28; // escalonado hacia la derecha
const VISIBLE = 3;

type Item = { id: number; pos: number; done: boolean };

// Cada ~3,5 s entra un mensaje por abajo, la IA lo analiza y decide, y el de arriba sale.
// Con "reducir movimiento" quedan quietas las tres primeras.
export function LiveComments() {
  const [items, setItems] = useState<Item[]>(() => Array.from({ length: VISIBLE }, (_, i) => ({ id: i, pos: i, done: true })));

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let next = VISIBLE;
    let timer: ReturnType<typeof setTimeout>;
    const later = (ms: number, f: () => void) => (timer = setTimeout(f, ms));
    const cycle = () => {
      const id = next++;
      setItems((xs) => [...xs, { id, pos: VISIBLE, done: false }]); // aparece invisible, debajo
      later(60, () => {
        setItems((xs) => xs.map((x) => ({ ...x, pos: x.pos - 1 }))); // todo sube un lugar; el de arriba sale
        later(1400, () => {
          setItems((xs) => xs.filter((x) => x.pos >= 0).map((x) => (x.id === id ? { ...x, done: true } : x)));
          later(2100, cycle);
        });
      });
    };
    later(1800, cycle);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ul className="relative mt-10" style={{ height: SLOT * VISIBLE - 12 }}>
      {items.map(({ id, pos, done }) => {
        const e = EXAMPLES[id % EXAMPLES.length];
        const Icon = e.dm ? Send : MessageCircle;
        const shown = pos >= 0 && pos < VISIBLE;
        const hidden = done && e.outcome === "oculta";
        return (
          <li
            key={id}
            className="absolute top-0 left-0 h-28 w-[min(28rem,calc(100%-3.5rem))] rounded-xl bg-white p-4 text-ink shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)] transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{ transform: `translate(${Math.max(pos, 0) * SHIFT}px, ${pos * SLOT}px) scale(${shown ? 1 : 0.96})`, opacity: shown ? 1 : 0 }}
          >
            <p className="flex items-center gap-1.5 text-[12px] font-bold text-ink-3">
              <Icon size={13} /> {e.channel}
            </p>
            <p className={`mt-1 truncate text-[15px] transition-[filter,opacity] duration-500 ${hidden ? "opacity-40 blur-[3px]" : ""}`}>{e.text}</p>
            <p className="mt-2.5 flex items-center gap-2 text-[13px] font-bold text-ink-2">
              <span className={`size-2 shrink-0 rounded-full transition-colors duration-300 ${done ? DOT[e.outcome] : "bg-line-strong motion-safe:animate-pulse"}`} />
              <span className="truncate">{done ? e.label : "La IA está leyendo el mensaje…"}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
