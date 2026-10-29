// Respuesta de las acciones de Usuarios a sus formularios. La contraseña temporal viaja una sola vez, aquí.
export type FormState = {
  error?: string;
  ok?: string;
  credentials?: { username: string; password: string };
  values?: Record<string, string>;
} | null;
