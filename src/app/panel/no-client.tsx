import { Empty } from "./ui";
import { currentUser } from "./current";

// Lo que se ve cuando la persona no tiene un cliente que mostrar. Vive aparte de ui.tsx: ese archivo
// lo usan componentes del navegador y no puede traer el servidor (cookies, base).
export async function NoClient() {
  const me = await currentUser(undefined, true);
  if (me.role !== "admin") {
    return (
      <Empty title="Todavía no tienes clientes asignados">
        Pídele a una persona administradora que te asigne uno en Usuarios.
      </Empty>
    );
  }
  return (
    <Empty title="Todavía no hay clientes" action={{ href: "/panel/clientes", label: "Crear cliente" }}>
      Crea el primero en Clientes y conecta sus cuentas de Facebook e Instagram.
    </Empty>
  );
}
