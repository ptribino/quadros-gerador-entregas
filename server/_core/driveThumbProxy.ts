import type { Express, Request, Response } from "express";
import { sdk } from "./sdk";
import { getValidAccessToken } from "./oauth";

/**
 * Proxy autenticado pra exibir imagens do banco do Drive dentro do sistema
 * (grade de miniaturas na curadoria de catálogo). Diferente de imageProxy.ts
 * (que exige o arquivo público, usado nas imagens já geradas pra Tray), aqui
 * o arquivo pode ser privado — a permissão vem da sessão do próprio usuário
 * (mesmo access_token usado em listFolders/getFileContent).
 *
 * Serve o `thumbnailLink` do Drive (poucos KB, já redimensionado por eles)
 * em vez do arquivo original — antes baixava o arquivo inteiro (potencialmente
 * vários MB) só pra exibir num quadrado de 40-100px, deixando a grade de
 * miniaturas lenta. Cai pro arquivo original (`alt=media`) se o Drive não
 * tiver gerado thumbnail pro arquivo (raro, mas acontece com uploads recentes).
 */

const FILE_ID_RE = /^[a-zA-Z0-9_-]+$/;

// Tamanho suficiente pra qualquer uso atual (maior caixa é ~100px) já
// considerando telas retina; bem menor que o arquivo original.
const THUMB_SIZE = 300;

interface CacheEntry {
  buffer: Buffer;
  contentType: string;
  expiresAt: number;
}

// Cache em memória simples: evita rebater na API do Drive (metadata + fetch
// da imagem) toda vez que a grade de miniaturas é recarregada. Ferramenta
// interna de poucos usuários — não precisa de LRU/limite de tamanho.
const thumbCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function fetchThumbnail(fileId: string, accessToken: string): Promise<{ buffer: Buffer; contentType: string }> {
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (metaRes.ok) {
    const meta = (await metaRes.json()) as { thumbnailLink?: string };
    if (meta.thumbnailLink) {
      // Drive retorna algo como "...=s220"; troca pro tamanho que queremos.
      const sizedUrl = meta.thumbnailLink.replace(/=s\d+$/, `=s${THUMB_SIZE}`);
      const thumbRes = await fetch(sizedUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (thumbRes.ok) {
        return {
          buffer: Buffer.from(await thumbRes.arrayBuffer()),
          contentType: thumbRes.headers.get("content-type") ?? "image/jpeg",
        };
      }
    }
  }

  // Fallback: sem thumbnailLink disponível, baixa o arquivo original.
  const upstream = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!upstream.ok) {
    throw new Error(`Drive returned ${upstream.status}`);
  }
  return {
    buffer: Buffer.from(await upstream.arrayBuffer()),
    contentType: upstream.headers.get("content-type") ?? "image/jpeg",
  };
}

export function registerDriveThumbProxy(app: Express) {
  app.get("/api/drive-thumb/:fileId", async (req: Request, res: Response) => {
    const { fileId } = req.params;
    if (!FILE_ID_RE.test(fileId)) {
      return res.status(400).send("Invalid file id");
    }

    const user = await sdk.authenticateRequest(req).catch(() => null);
    if (!user) {
      return res.status(401).send("Login necessário");
    }

    const cached = thumbCache.get(fileId);
    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("Cache-Control", "private, max-age=86400");
      return res.send(cached.buffer);
    }

    const accessToken = await getValidAccessToken(user.openId);
    if (!accessToken) {
      return res.status(401).send("Faça login com Google para acessar o Drive");
    }

    try {
      const { buffer, contentType } = await fetchThumbnail(fileId, accessToken);
      thumbCache.set(fileId, { buffer, contentType, expiresAt: Date.now() + CACHE_TTL_MS });

      res.setHeader("Content-Type", contentType);
      // "private" (não CDN/proxy compartilhado) porque o acesso depende do
      // token do usuário — cache do navegador + cache em memória do servidor.
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.send(buffer);
    } catch (error) {
      console.error("[driveThumbProxy] Error fetching", fileId, error);
      res.status(500).send("Proxy error");
    }
  });
}
