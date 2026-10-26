import type { Metadata } from "next";
import { CONTACTO } from "@/lib/legal";

export const metadata: Metadata = { title: "Eliminación de datos · Ogilvy Social Care" };

export default function EliminacionDeDatos() {
  return (
    <>
      <h1>Eliminación de datos</h1>

      <h2>Si le escribiste a una marca</h2>
      <p>
        Escribe a <a href={`mailto:${CONTACTO}?subject=Eliminaci%C3%B3n%20de%20datos`}>{CONTACTO}</a> con el asunto
        &quot;Eliminación de datos&quot; e indica:
      </p>
      <ul>
        <li>tu nombre de usuario de Facebook o Instagram;</li>
        <li>la marca a la que le escribiste.</li>
      </ul>
      <p>
        Borramos lo que la plataforma guarde sobre ti y te confirmamos por correo en un máximo de 15 días hábiles. Lo que
        ya esté en los sistemas de la marca lo elimina la marca; nosotros le trasladamos tu solicitud.
      </p>

      <h2>Si administras una marca conectada</h2>
      <p>
        En la configuración de tu portafolio comercial de Meta, entra a Integraciones → Apps conectadas y quita Ogilvy
        Social Care. Luego escríbenos a <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a> para borrar los datos de tu
        marca en la plataforma.
      </p>
    </>
  );
}
