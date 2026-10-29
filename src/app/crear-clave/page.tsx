import { InvitationPage } from "./view";

// Enlaces de antes: /crear-clave?t=<código>. Los nuevos son /c/<código>.
export default async function CrearClave({ searchParams }: PageProps<"/crear-clave">) {
  const sp = await searchParams;
  return <InvitationPage token={typeof sp.t === "string" ? sp.t.slice(0, 500) : ""} />;
}
