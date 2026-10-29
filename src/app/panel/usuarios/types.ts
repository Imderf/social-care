// Respuesta de las acciones de Usuarios a sus formularios. La contraseña temporal o el enlace viajan una sola vez, aquí.
export type FormState = {
  error?: string;
  ok?: string;
  credentials?: { username: string; password?: string; link?: string };
  values?: Record<string, string>;
} | null;
