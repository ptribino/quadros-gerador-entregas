import type { Express, Request, Response } from "express";

/**
 * Proxy de imagens do Google Drive com extensão `.jpg` na URL.
 *
 * Por que existe: a Tray (e outros e-commerces) valida a EXTENSÃO da URL
 * antes de tentar baixar a imagem. URLs do Drive (`uc?export=download&id=...`,
 * `lh3.googleusercontent.com/d/...`) não terminam em `.jpg`/`.png`, então
 * a Tray rejeita com "Extensão não permitida".
 *
 * Este endpoint expõe `/img/<fileId>.jpg` (extensão visível na URL) e por
 * baixo faz fetch do Drive, devolvendo o binário. Depois que a Tray importa,
 * ela copia a imagem pro CDN dela (`tcdn.com.br`) e não pede mais — então
 * a latência do proxy só conta na primeira leitura.
 *
 * Pré-requisito: o arquivo no Drive precisa estar com permissão pública
 * (`anyone with link can view`). O pipeline já faz isso via `makePublic`.
 */

const SUPPORTED_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const FILE_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function registerImageProxy(app: Express) {
  app.get("/img/:filename", async (req: Request, res: Response) => {
    const { filename } = req.params;
    const dotIdx = filename.lastIndexOf(".");
    if (dotIdx <= 0) {
      return res.status(400).send("Filename must include an extension");
    }
    const fileId = filename.slice(0, dotIdx);
    const ext = filename.slice(dotIdx + 1).toLowerCase();

    if (!FILE_ID_RE.test(fileId)) {
      return res.status(400).send("Invalid file id");
    }
    const contentType = SUPPORTED_EXT[ext];
    if (!contentType) {
      return res.status(400).send("Unsupported extension");
    }

    const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    try {
      const upstream = await fetch(driveUrl, { redirect: "follow" });

      if (!upstream.ok) {
        return res
          .status(upstream.status)
          .send(`Drive returned ${upstream.status}`);
      }

      const upstreamCT = upstream.headers.get("content-type") ?? "";
      // Drive devolve HTML quando o arquivo não está público ou precisa de
      // confirmação anti-vírus (arquivos >100MB). Nossas imagens são <1MB,
      // então HTML aqui significa permissão revogada.
      if (upstreamCT.includes("text/html")) {
        return res
          .status(502)
          .send("Drive returned HTML — arquivo provavelmente não está público");
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    } catch (error) {
      console.error("[imageProxy] Error fetching", fileId, error);
      res.status(500).send("Proxy error");
    }
  });
}
