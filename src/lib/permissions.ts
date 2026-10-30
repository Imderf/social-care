// Roles y permisos del panel. Sin dependencias del servidor: lo usan también el menú y los formularios (navegador).

export const ROLES = ["admin", "colaborador", "operador", "verificador"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = { admin: "Administrador", colaborador: "Colaborador", operador: "Operador", verificador: "Verificador" };
export const ROLE_HELP: Record<Role, string> = {
  admin: "Todo: configuración, clientes, usuarios, Bandeja y Pruebas.",
  colaborador: "Todo lo del administrador, menos Usuarios, y solo en los clientes que tiene asignados.",
  operador: "Atiende la Bandeja e Interacciones y responde desde la plataforma.",
  verificador: "Revisa las propuestas de la IA en Pruebas: acepta, corrige o descarta.",
};

// «bandeja» (administrador, colaborador y operador), «pruebas» (administrador, colaborador y verificador),
// «config» y «clientes» (administrador y colaborador: el colaborador solo en los clientes que tiene asignados) y
// «usuarios» (solo administrador: gestiona las cuentas de las personas). Resumen y Mi cuenta los ven todos los roles.
export type Permission = "bandeja" | "pruebas" | "config" | "clientes" | "usuarios";
export const ALLOWED: Record<Permission, readonly Role[]> = {
  bandeja: ["admin", "colaborador", "operador"],
  pruebas: ["admin", "colaborador", "verificador"],
  config: ["admin", "colaborador"],
  clientes: ["admin", "colaborador"],
  usuarios: ["admin"],
};
export const can = (role: Role, permission: Permission) => ALLOWED[permission].includes(role);
