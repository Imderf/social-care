import type { Metadata } from "next";
import Link from "next/link";
import { CONTACTO } from "@/lib/legal";

export const metadata: Metadata = { title: "Política de privacidad · Ogilvy Social Care" };

export default function Privacidad() {
  return (
    <>
      <h1>Política de privacidad</h1>
      <p>
        Ogilvy Social Care es una herramienta de Ogilvy &amp; Mather Colombia S.A.S. (&quot;Ogilvy&quot;) que ayuda a
        las marcas clientes de Ogilvy a responder los comentarios y mensajes que reciben en sus páginas de Facebook y
        sus cuentas de Instagram.
      </p>

      <h2>Quién es responsable de tus datos</h2>
      <p>
        Cada marca es responsable del tratamiento de los datos de las personas que le escriben. Ogilvy actúa como
        encargado del tratamiento: trata los datos solo por cuenta de la marca y según sus instrucciones, conforme a la
        Ley 1581 de 2012 y sus normas reglamentarias.
      </p>

      <h2>Qué datos tratamos</h2>
      <ul>
        <li>
          Los comentarios públicos y los mensajes privados enviados a las páginas y cuentas de las marcas conectadas,
          con el nombre de usuario y el identificador que entrega Meta.
        </li>
        <li>
          Los datos que entregues por mensaje privado después de autorizar su tratamiento, para que la marca atienda tu
          solicitud. Se envían a los sistemas de la marca y la plataforma los borra apenas quedan registrados.
        </li>
        <li>La plataforma no conserva números de documento, fórmulas médicas ni diagnósticos.</li>
      </ul>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Responder comentarios y mensajes en nombre de la marca, de forma automática o por una persona del equipo.</li>
        <li>Registrar los casos en los sistemas de la marca y hacerles seguimiento.</li>
        <li>Medir los tiempos y la calidad de la atención.</li>
      </ul>

      <h2>Con quién los compartimos</h2>
      <ul>
        <li>Con la marca a la que escribiste.</li>
        <li>
          Con los proveedores que prestan el servicio: Meta (Facebook e Instagram); OpenAI, para clasificar el texto,
          que le llega con documentos, teléfonos, correos y direcciones enmascarados y que no se usa para entrenar
          modelos; y Google, para las hojas de cálculo y carpetas de la marca. La base de datos de la plataforma está
          en un servidor administrado por Ogilvy.
        </li>
        <li>No vendemos datos ni los usamos para publicidad.</li>
      </ul>

      <h2>Cuánto tiempo los conservamos</h2>
      <ul>
        <li>Los eventos que envía Meta se borran a los 7 días.</li>
        <li>Los datos entregados por mensaje privado se borran apenas quedan registrados en los sistemas de la marca.</li>
        <li>El historial de atención se conserva mientras la marca use el servicio, salvo que pidas eliminarlo.</li>
      </ul>

      <h2>Tus derechos</h2>
      <p>
        Puedes conocer, actualizar, rectificar y pedir la eliminación de tus datos, y revocar la autorización,
        escribiendo a <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a> o directamente a la marca. Respondemos las
        consultas en un máximo de 10 días hábiles y los reclamos en un máximo de 15 días hábiles. Para pedir la
        eliminación, sigue las <Link href="/eliminacion-de-datos">instrucciones de eliminación de datos</Link>.
      </p>

      <h2>Cambios</h2>
      <p>Cualquier cambio a esta política se publica en esta página, con su fecha de actualización.</p>
    </>
  );
}
