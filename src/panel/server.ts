import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadEnv } from "../lib/env.js";

/**
 * server.ts — entry point del panel. Escucha SOLO en 127.0.0.1: nunca debe
 * quedar expuesto directo a internet. nginx hace de reverse proxy con TLS en
 * un subdominio propio (panel.kronet.app), separado de cards.kronet.app
 * (ver infra/nginx/panel.kronet.app.conf).
 */
loadEnv();

const port = Number(process.env.PANEL_PORT ?? 4010);

serve({ fetch: createApp().fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`panel escuchando en http://127.0.0.1:${info.port}`);
});
