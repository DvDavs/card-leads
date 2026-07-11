import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { loadEnv } from "../lib/env.js";

/**
 * auth.ts — passphrase compartida -> cookie de sesion firmada (HMAC), sobre
 * HTTPS. Es una herramienta INTERNA (vos + equipo), asi que un solo secreto
 * compartido alcanza: no hay usuarios individuales ni auditoria por persona.
 * Rotar PANEL_SESSION_SECRET desloguea a todo el mundo (a proposito: es la
 * unica forma de invalidar sesiones existentes).
 */

loadEnv();

const COOKIE_NAME = "panel_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`panel: falta ${name} en .env (ver .env.example)`);
  }
  return v;
}

function sign(payload: string): string {
  return createHmac("sha256", requiredEnv("PANEL_SESSION_SECRET")).update(payload).digest("base64url");
}

/** Compara la passphrase ingresada contra PANEL_PASSPHRASE, tiempo constante. */
export function checkPassphrase(candidate: string): boolean {
  const expected = requiredEnv("PANEL_PASSPHRASE");
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // timingSafeEqual exige mismo largo; si difiere ya sabemos que no matchea.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** payload.firma, ambos base64url. payload = timestamp de expiracion. */
function createSessionValue(): string {
  const payload = String(Date.now() + SESSION_TTL_MS);
  return `${payload}.${sign(payload)}`;
}

function verifySessionValue(value: string | undefined): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 0) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expectedSig = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && Date.now() <= exp;
}

export function setSessionCookie(c: Context): void {
  setCookie(c, COOKIE_NAME, createSessionValue(), {
    httpOnly: true,
    // Secure real en produccion (HTTPS obligatorio detras de nginx). En dev
    // local (NODE_ENV != production) se relaja para poder probar el flujo
    // completo por http sin certificado.
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

/** Middleware Hono: 401 si no hay cookie de sesion valida. */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  if (!verifySessionValue(getCookie(c, COOKIE_NAME))) {
    return c.json({ error: "no autenticado" }, 401);
  }
  await next();
}
