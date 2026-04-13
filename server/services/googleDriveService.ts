import { ENV } from '../_core/env';

interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
}

class GoogleDriveService {
  private baseUrl = 'https://www.googleapis.com/drive/v3';
  private uploadUrl = 'https://www.googleapis.com/upload/drive/v3';

  /**
   * Renova o access_token usando o refresh_token
   */
  async refreshAccessToken(refreshToken: string): Promise<string> {
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

    const data = await response.json() as { access_token: string };
    return data.access_token;
  }

  /**
   * Salva um arquivo no Google Drive do usuário
   * Usa multipart upload para enviar metadados + conteúdo juntos
   */
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
   * Lista arquivos do Google Drive do usuário
   */
  async listFiles(accessToken: string, folderId?: string): Promise<GoogleDriveFile[]> {
    const params = new URLSearchParams({
      spaces: 'drive',
      fields: 'files(id,name,mimeType,webViewLink)',
      pageSize: '100',
      orderBy: 'createdTime desc',
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
   * Lista pastas do Google Drive do usuário
   */
  async listFolders(accessToken: string): Promise<GoogleDriveFile[]> {
    const params = new URLSearchParams({
      spaces: 'drive',
      fields: 'files(id,name,mimeType,webViewLink)',
      pageSize: '100',
      orderBy: 'name',
      q: `mimeType = 'application/vnd.google-apps.folder' and trashed=false`,
    });

    const response = await fetch(`${this.baseUrl}/files?${params}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Drive list folders failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as { files: GoogleDriveFile[] };
    return data.files || [];
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
