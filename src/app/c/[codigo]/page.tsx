import { InvitationPage } from "../../crear-clave/view";

// Enlace corto para crear la contraseña: /c/<código>.
export default function Invitacion({ params }: PageProps<"/c/[codigo]">) {
  return <InvitationPage token={params.then((p) => p.codigo.slice(0, 500))} />;
}
