import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Túnel fijo de Cloudflare para recibir webhooks de Meta en local (solo afecta a next dev).
  allowedDevOrigins: ["socialcare.colombiaogilvy.com"],
  poweredByHeader: false,
  // ponytail: la raíz lleva al panel (y este a Ingresar) hasta que exista la página principal pública.
  async redirects() {
    return [{ source: "/", destination: "/panel", permanent: false }];
  },
  // El panel no se muestra dentro de otros sitios ni adivina tipos de archivo.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
