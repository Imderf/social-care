// Roles y permisos del panel. Sin dependencias del servidor: lo usan también el menú y los formularios (navegador).

export const ROLES = ["admin", "operador", "verificador"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = { admin: "Administrador", operador: "Operador", verificador: "Verificador" };
export const ROLE_HELP: Record<Role, string> = {
  admin: "Todo: configuración, clientes, usuarios, Bandeja y Pruebas.",
  operador: "Atiende la Bandeja e Interacciones y responde desde la plataforma.",
  verificador: "Revisa las propuestas de la IA en Pruebas: acepta, corrige o descarta.",
};

// «bandeja» (administrador y operador), «pruebas» (administrador y verificador) y «config» o «usuarios»
// (solo administrador). Resumen y Mi cuenta los ven todos los roles.
export type Permission = "bandeja" | "pruebas" | "config" | "usuarios";
export const ALLOWED: Record<Permission, readonly Role[]> = {
  bandeja: ["admin", "operador"],
  pruebas: ["admin", "verificador"],
  config: ["admin"],
  usuarios: ["admin"],
};
export const can = (role: Role, permission: Permission) => ALLOWED[permission].includes(role);
