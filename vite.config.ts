import { defineConfig } from "vite";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export default defineConfig({
  base: "./",
  server: { headers: cors },
  preview: {
    headers: {
      ...cors,
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self' https:; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; base-uri 'self'; form-action 'none'; object-src 'none'",
    },
  },
});
