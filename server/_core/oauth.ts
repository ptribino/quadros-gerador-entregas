import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { SignJWT } from "jose";
import crypto from "crypto";

// In-memory store para tokens do Google (por openId)
// Usado pelo Drive para acessar o Google Drive do usuário
export const googleTokenStore = new Map<string, { accessToken: string; refreshToken?: string }>();

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Gera a URL de autorização do Google OAuth 2.0
 */
function getGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: ENV.googleClientId,
    redirect_uri: ENV.googleRedirectUri,
    response_type: "code",
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Troca o authorization code por tokens do Google
 */
async function exchangeGoogleCode(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
}> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: ENV.googleClientId,
      client_secret: ENV.googleClientSecret,
      redirect_uri: ENV.googleRedirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google token exchange failed: ${errorText}`);
  }

  return response.json();
}

/**
 * Obtém informações do usuário do Google
 */
async function getGoogleUserInfo(accessToken: string): Promise<{
  sub: string;
  name: string;
  email: string;
  picture: string;
}> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("Failed to get Google user info");
  }

  return response.json();
}

/**
 * Cria um JWT de sessão para o usuário
 */
async function createSessionJWT(payload: {
  openId: string;
  name: string;
  email: string;
}): Promise<string> {
  const secret = new TextEncoder().encode(ENV.cookieSecret);
  const expiresInMs = ONE_YEAR_MS;

  return new SignJWT({
    openId: payload.openId,
    appId: ENV.appId,
    name: payload.name,
    email: payload.email,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor((Date.now() + expiresInMs) / 1000))
    .sign(secret);
}

export function registerOAuthRoutes(app: Express) {
  /**
   * Inicia o fluxo de login Google OAuth
   */
  app.get("/api/oauth/google/login", (_req: Request, res: Response) => {
    const state = crypto.randomBytes(16).toString("hex");
    const authUrl = getGoogleAuthUrl(state);
    res.redirect(302, authUrl);
  });

  /**
   * Callback do Google OAuth — troca code por token, cria sessão
   */
  app.get("/api/oauth/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const error = getQueryParam(req, "error");

    if (error) {
      console.error("[OAuth] Google returned error:", error);
      res.redirect(302, "/?error=auth_denied");
      return;
    }

    if (!code) {
      res.status(400).json({ error: "Authorization code is required" });
      return;
    }

    try {
      // 1. Troca o code por tokens
      const tokens = await exchangeGoogleCode(code);

      // 2. Obtém informações do usuário
      const userInfo = await getGoogleUserInfo(tokens.access_token);

      if (!userInfo.sub) {
        res.status(400).json({ error: "Google user ID missing" });
        return;
      }

      // 3. Tenta salvar no banco (não bloqueia se falhar)
      try {
        await db.upsertUser({
          openId: userInfo.sub,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: "google",
          lastSignedIn: new Date(),
        });
      } catch (dbErr) {
        console.warn("[OAuth] DB upsert failed (non-fatal):", dbErr instanceof Error ? dbErr.message : dbErr);
      }

      // 4. Guarda tokens Google em memória (para Google Drive)
      googleTokenStore.set(userInfo.sub, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });

      // 5. Cria JWT de sessão (apenas dados do usuário, sem tokens)
      const sessionToken = await createSessionJWT({
        openId: userInfo.sub,
        name: userInfo.name || "",
        email: userInfo.email || "",
      });

      // 5. Define o cookie de sessão
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      console.log("[OAuth] Login success for:", userInfo.email, "- setting cookie and redirecting");
      res.redirect(302, "/");
    } catch (err) {
      console.error("[OAuth] Google callback failed:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[OAuth] Detail:", errorMsg);
      res.status(500).json({ error: "OAuth callback failed", detail: errorMsg });
    }
  });

  // Redireciona o callback legado para o novo fluxo Google
  app.get("/api/oauth/callback", async (_req: Request, res: Response) => {
    res.redirect(302, "/api/oauth/google/login");
  });
}
