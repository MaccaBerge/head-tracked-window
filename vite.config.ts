import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";

/**
 * `npm run host` serves the app to other computers on the home network.
 * Browsers only allow the webcam on https pages (or localhost), so it uses
 * the self-signed certificate in .certs/ (see README). Plain `npm run dev`
 * is unchanged.
 */
export default defineConfig(({ mode }) => {
  const certs = ".certs";
  const lan = mode === "lan" && existsSync(`${certs}/key.pem`);
  return {
    server: lan
      ? {
          host: true,
          https: { key: readFileSync(`${certs}/key.pem`), cert: readFileSync(`${certs}/cert.pem`) },
        }
      : {},
  };
});
