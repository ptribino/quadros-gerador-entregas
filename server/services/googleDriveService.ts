import { ENV } from '../_core/env';

/**
 * Extrai o ID puro de um arquivo do Drive a partir de qualquer formato
 * comum (URL completa, "d/<id>", ou só o ID). Defensivo contra
 * copy/paste que inclui o `d/` sem querer.
 */
export function extractDriveFileId(input: string): string {
  if (!input) return input;
  const trimmed = input.trim();
  // URL completa: https://drive.google.com/file/d/<ID>/view  ou  uc?...&id=<ID>
  const fromUrlD = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fromUrlD) return fromUrlD[1];
  const fromUrlId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (fromUrlId) return fromUrlId[1];
  // Path tipo "d/<ID>"
  if (trimmed.startsWith("d/")) return trimmed.slice(2).split(/[/?]/, 1)[0]!;
  // Já é só o ID
  return trimmed;
}

interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  shortcutDetails?: {
    targetId: string;
    targetMimeType: string;
  };
}

class GoogleDriveService {
  private baseUrl = 'https://www.googleapis.com/drive/v3';
  private uploadUrl = 'https://www.googleapis.com/upload/drive/v3';

  /**
   * Renova o access_token usando o refresh_token. Retorna o novo token e
   * o `expires_in` em segundos (~3600 na maior parte dos casos) para que o
   * chamador consiga calcular o `expiresAt` e persistir.
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: ENV.googleClientId,
        client_secret: ENV.googleClientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to refresh Google token: ${errorText}`);
    }

    const data = await response.json() as { access_token: string; expires_in?: number };
    return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
  }

  /**
   * Salva um arquivo no Google Drive do usuário
   * Usa multipart upload para enviar metadados + conteúdo juntos
   */
  /**
   * Faz upload sobrescrevendo: se já houver arquivo(s) com o mesmo `fileName`
   * dentro de `folderId`, eles são movidos para a lixeira antes do novo upload.
   *
   * Usado pelo pipeline de catálogo quando o usuário re-gera um produto —
   * sem isso, o Drive aceita arquivos com nome idêntico e a pasta acumula
   * duplicatas (URL antiga continua válida mas as `imageUrl*` no DB apontam
   * pra cópia nova; o produto fica com lixo visual no Drive).
   */
  async uploadFileReplacing(
    accessToken: string,
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string,
    folderId: string,
  ): Promise<GoogleDriveFile> {
    const existing = await this.findFilesByName(accessToken, fileName, folderId);
    for (const f of existing) {
      await this.deleteFile(accessToken, f.id).catch((err) => {
        // Se falhar deletar o antigo, segue com upload — o estado fica
        // duplicado mas não bloqueia o pipeline.
        console.warn(`[GoogleDrive] Falha ao limpar duplicata ${f.id} (${fileName}):`, err);
      });
    }
    return this.uploadFile(accessToken, fileName, fileBuffer, mimeType, folderId);
  }

  /**
   * Busca arquivos por nome exato dentro de uma pasta. Útil para cleanup
   * antes de re-upload (evitar duplicatas com mesmo nome).
   */
  async findFilesByName(
    accessToken: string,
    name: string,
    folderId: string,
  ): Promise<GoogleDriveFile[]> {
    // Escape aspas simples no nome (Drive query syntax)
    const safeName = name.replace(/'/g, "\\'");
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and name='${safeName}' and trashed=false`,
      fields: "files(id,name,mimeType,webViewLink)",
      pageSize: "50",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
    });

    const response = await fetch(`${this.baseUrl}/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Drive findFilesByName failed (${response.status}): ${errorText}`);
    }
    const data = (await response.json()) as { files: GoogleDriveFile[] };
    return data.files || [];
  }

  /**
   * Move um arquivo para a lixeira do Drive (não apaga permanentemente).
   */
  async deleteFile(accessToken: string, fileId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/files/${fileId}?supportsAllDrives=true`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      throw new Error(`Drive delete failed (${response.status}): ${errorText}`);
    }
  }

  async uploadFile(
    accessToken: string,
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string,
    folderId?: string
  ): Promise<GoogleDriveFile> {
    const metadata = {
      name: fileName,
      parents: folderId ? [folderId] : undefined,
    };

    // Multipart upload: metadados JSON + bytes do arquivo
    const boundary = 'quadros_upload_boundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
      ),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const response = await fetch(
      `${this.uploadUrl}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[GoogleDrive] Upload error:', errorText);
      throw new Error(`Drive upload failed (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<GoogleDriveFile>;
  }

  /**
   * Lista arquivos do Google Drive do usuário.
   * Inclui suporte a Shared Drives (necessário quando a pasta de origem
   * vive num drive compartilhado externo, comum no fluxo de banco de imagens).
   */
  async listFiles(accessToken: string, folderId?: string): Promise<GoogleDriveFile[]> {
    const params = new URLSearchParams({
      fields: 'files(id,name,mimeType,webViewLink)',
      pageSize: '100',
      orderBy: 'createdTime desc',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    });

    const query = folderId
      ? `'${folderId}' in parents and trashed=false and mimeType contains 'image/'`
      : `trashed=false and mimeType contains 'image/'`;
    params.set('q', query);

    const response = await fetch(`${this.baseUrl}/files?${params}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Drive list failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as { files: GoogleDriveFile[] };
    return data.files || [];
  }

  /**
   * Lista pastas do Google Drive do usuário.
   * Se parentFolderId for informado, retorna apenas subpastas dessa pasta.
   *
   * Inclui também atalhos (shortcuts) que apontam para pastas — necessário
   * quando o "banco" do usuário é uma pasta cheia de atalhos para um drive
   * compartilhado externo. Para shortcuts, o `id` retornado é o `targetId`
   * (a pasta real), o nome continua sendo o do shortcut.
   */
  async listFolders(accessToken: string, parentFolderId?: string): Promise<GoogleDriveFile[]> {
    const folderType = "application/vnd.google-apps.folder";
    const shortcutType = "application/vnd.google-apps.shortcut";
    // Inclui pastas reais E atalhos (filtramos os atalhos que apontam para pasta depois)
    const baseQ = `(mimeType = '${folderType}' or mimeType = '${shortcutType}') and trashed=false`;
    const q = parentFolderId ? `${baseQ} and '${parentFolderId}' in parents` : baseQ;
    const params = new URLSearchParams({
      fields: 'files(id,name,mimeType,webViewLink,shortcutDetails)',
      pageSize: '100',
      orderBy: 'name',
      // Necessário pra enxergar subpastas em shared drives — sem isso a API
      // retorna 0 quando navegamos dentro de "Compartilhados comigo" (caso
      // do banco de imagens da GN Packz).
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
      q,
    });

    const response = await fetch(`${this.baseUrl}/files?${params}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Drive list folders failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as { files: GoogleDriveFile[] };
    const all = data.files || [];

    // Normaliza: para shortcuts que apontam para pasta, usa o targetId como id.
    // Atalhos que apontam para outro tipo de item são descartados.
    return all.flatMap((f) => {
      if (f.mimeType === folderType) return [f];
      if (f.mimeType === shortcutType && f.shortcutDetails?.targetMimeType === folderType) {
        return [{
          id: f.shortcutDetails.targetId,
          name: f.name,
          mimeType: folderType,
          webViewLink: f.webViewLink,
        }];
      }
      return [];
    });
  }

  /**
   * Cria uma pasta dentro de um pai (ou na raiz do Drive se parentId
   * não informado). Idempotente por nome: se já existir uma pasta com
   * mesmo nome no mesmo pai, retorna a existente.
   */
  async getOrCreateFolder(
    accessToken: string,
    name: string,
    parentId?: string,
  ): Promise<GoogleDriveFile> {
    const folderType = "application/vnd.google-apps.folder";
    // Procura existente
    const escaped = name.replace(/'/g, "\\'");
    const baseQ = `mimeType = '${folderType}' and name = '${escaped}' and trashed = false`;
    const q = parentId ? `${baseQ} and '${parentId}' in parents` : baseQ;
    const findRes = await fetch(
      `${this.baseUrl}/files?${new URLSearchParams({
        q,
        fields: "files(id,name,mimeType,webViewLink)",
        pageSize: "1",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      })}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (findRes.ok) {
      const data = (await findRes.json()) as { files: GoogleDriveFile[] };
      if (data.files && data.files.length > 0) return data.files[0];
    }

    // Cria
    const createRes = await fetch(
      `${this.baseUrl}/files?supportsAllDrives=true&fields=id,name,mimeType,webViewLink`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          mimeType: folderType,
          parents: parentId ? [parentId] : undefined,
        }),
      },
    );
    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Drive create folder failed (${createRes.status}): ${errText}`);
    }
    return createRes.json() as Promise<GoogleDriveFile>;
  }

  /** Define permissão "qualquer pessoa com link pode ler". */
  async makePublic(accessToken: string, fileId: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/files/${fileId}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      },
    );
    if (!res.ok && res.status !== 409) {
      // 409 = permissão já existe — ok, é idempotente
      const errText = await res.text();
      throw new Error(`Drive makePublic failed (${res.status}): ${errText}`);
    }
  }

  /** Baixa um arquivo do Drive como Buffer (para reupload em outra pasta). */
  async downloadFile(accessToken: string, fileId: string): Promise<Buffer> {
    const res = await fetch(
      `${this.baseUrl}/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Drive download failed (${res.status}): ${errText}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * URL pública da imagem que vai para a planilha da Tray.
   *
   * Aponta pro nosso proxy `/img/<fileId>.jpg` em vez do Drive direto porque
   * a Tray valida EXTENSÃO na URL e rejeita `uc?export=download&id=...`.
   * O proxy faz fetch do Drive por baixo (ver server/_core/imageProxy.ts).
   *
   * Se `PUBLIC_APP_URL` não estiver configurado (ex: dev local sem ngrok),
   * cai pra URL Drive direta — funciona pra preview manual, falha na Tray.
   *
   * Aceita qualquer formato comum pra `fileId` (sanitiza p/ só o ID):
   *   - "1abc...XYZ"                                                (ID puro)
   *   - "d/1abc...XYZ"                                              (path comum no copy/paste)
   *   - "https://drive.google.com/file/d/1abc...XYZ/view"           (URL completa)
   *   - "https://drive.google.com/uc?export=download&id=1abc...XYZ" (URL já formada)
   */
  publicDownloadUrl(fileId: string): string {
    const id = extractDriveFileId(fileId);
    if (ENV.publicAppUrl) {
      return `${ENV.publicAppUrl}/img/${id}.jpg`;
    }
    return `https://drive.google.com/uc?export=download&id=${id}`;
  }

  /**
   * Lista imagens recursivamente: começa em folderId, e se não houver
   * imagens diretas, mergulha nas subpastas até maxDepth níveis.
   * Necessário pro banco de imagens, onde a pasta-mãe da categoria
   * (ex: "#PN Paisagens Naturais") não tem imagens, só sub-subpastas
   * (#PN01 Cachoeiras, #PN02 Céu, etc.) que contêm os arquivos.
   */
  async listImagesRecursive(
    accessToken: string,
    folderId: string,
    options: { maxDepth?: number; maxFiles?: number } = {},
  ): Promise<GoogleDriveFile[]> {
    const maxDepth = options.maxDepth ?? 3;
    const maxFiles = options.maxFiles ?? 500;

    const out: GoogleDriveFile[] = [];
    const queue: { id: string; depth: number }[] = [{ id: folderId, depth: 0 }];

    while (queue.length > 0 && out.length < maxFiles) {
      const { id, depth } = queue.shift()!;

      const files = await this.listFiles(accessToken, id);
      for (const f of files) {
        if (out.length >= maxFiles) break;
        out.push(f);
      }

      if (depth >= maxDepth) continue;

      const subfolders = await this.listFolders(accessToken, id);
      for (const sub of subfolders) {
        queue.push({ id: sub.id, depth: depth + 1 });
      }
    }

    return out;
  }

  /**
   * Baixa o conteúdo de um arquivo do Drive e retorna como base64
   */
  async getFileContent(accessToken: string, fileId: string, mimeType: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/files/${fileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Drive get file failed (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:${mimeType};base64,${base64}`;
  }
}

export const googleDriveService = new GoogleDriveService();
