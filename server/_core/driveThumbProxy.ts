import type { Express, Request, Response } from "express";
import { sdk } from "./sdk";
import { getValidAccessToken } from "./oauth";

/**
 * Proxy autenticado pra exibir imagens do banco do Drive dentro do sistema
 * (grade de miniaturas na curadoria de catálogo). Diferente de imageProxy.ts
 * (que exige o arquivo público, usado nas imagens já geradas pra Tray), aqui
 * o arquivo pode ser privado — a permissão vem da sessão do próprio usuário
 * (mesmo access_token usado em listFolders/getFileContent).
 */

const FILE_ID_RE = /^[a-zA-Z0-9_-]+$/;

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

    const accessToken = await getValidAccessToken(user.openId);
    if (!accessToken) {
      return res.status(401).send("Faça login com Google para acessar o Drive");
    }

    try {
      const upstream = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!upstream.ok) {
        return res.status(upstream.status).send(`Drive returned ${upstream.status}`);
      }

      const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
      res.setHeader("Content-Type", contentType);
      // "private" (não CDN/proxy compartilhado) porque o acesso depende do
      // token do usuário — só o cache do próprio navegador.
      res.setHeader("Cache-Control", "private, max-age=3600");

      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    } catch (error) {
      console.error("[driveThumbProxy] Error fetching", fileId, error);
      res.status(500).send("Proxy error");
    }
  });
}
