import { InvitationPage } from "./view";

// Enlaces de antes: /crear-clave?t=<código>. Los nuevos son /c/<código>.
export default function CrearClave({ searchParams }: PageProps<"/crear-clave">) {
  return <InvitationPage token={searchParams.then((sp) => (typeof sp.t === "string" ? sp.t.slice(0, 500) : ""))} />;
}
