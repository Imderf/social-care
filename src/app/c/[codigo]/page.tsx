import { InvitationPage } from "../../crear-clave/view";

// Enlace corto para crear la contraseña: /c/<código>.
export default async function Invitacion({ params }: PageProps<"/c/[codigo]">) {
  const { codigo } = await params;
  return <InvitationPage token={codigo.slice(0, 500)} />;
}
