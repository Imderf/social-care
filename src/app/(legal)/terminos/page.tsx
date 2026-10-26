import type { Metadata } from "next";
import Link from "next/link";
import { CONTACTO } from "@/lib/legal";

export const metadata: Metadata = { title: "Términos del servicio · Ogilvy Social Care" };

export default function Terminos() {
  return (
    <>
      <h1>Términos del servicio</h1>
      <ul>
        <li>
          Ogilvy Social Care es una herramienta privada de Ogilvy &amp; Mather Colombia S.A.S. para las marcas que
          tienen un contrato de servicios con Ogilvy. El acceso al panel es solo por invitación.
        </li>
        <li>
          Las marcas conectan sus páginas de Facebook y sus cuentas de Instagram autorizando la app desde su portafolio
          comercial de Meta, y pueden desconectarlas en cualquier momento.
        </li>
        <li>
          Las respuestas automáticas parten de plantillas aprobadas por cada marca. Lo que la herramienta no puede
          resolver lo atiende una persona del equipo.
        </li>
        <li>Las respuestas no son consejo médico ni reemplazan la atención de un profesional.</li>
        <li>
          Quienes escriben a las marcas por Facebook o Instagram lo hacen bajo las condiciones de Meta. El tratamiento
          de sus datos se rige por la <Link href="/privacidad">política de privacidad</Link>.
        </li>
      </ul>
      <p>
        Preguntas sobre estos términos: <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
      </p>
    </>
  );
}
