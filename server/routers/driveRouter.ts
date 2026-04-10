import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';
import { googleDriveService } from '../services/googleDriveService';
import { googleTokenStore } from '../_core/oauth';
import { TRPCError } from '@trpc/server';

/**
 * Obtém o access_token do Google do usuário logado (do store em memória)
 */
function getUserAccessToken(openId: string): string {
  const tokens = googleTokenStore.get(openId);
  if (!tokens?.accessToken) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Faça login com Google para salvar no Drive',
    });
  }
  return tokens.accessToken;
}

/**
 * Converte data URL para Buffer
 */
function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } {
  if (dataUrl.startsWith('data:')) {
    const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
    const mimeType = mimeMatch?.[1] || 'image/png';
    const base64 = dataUrl.split(',')[1];
    if (!base64) throw new Error('Invalid data URL');
    return { buffer: Buffer.from(base64, 'base64'), mimeType };
  }
  throw new Error('Formato de URL não suportado.');
}

export const driveRouter = router({
  saveImage: protectedProcedure
    .input(
      z.object({
        imageUrl: z.string().min(1, 'URL da imagem é obrigatória'),
        fileName: z.string().min(1, 'Nome do arquivo é obrigatório'),
        type: z.enum(['lifestyle', 'mockup', 'video']),
        frameType: z.enum(['pine', 'aluminum']),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const accessToken = getUserAccessToken(ctx.user!.openId);
        const { buffer, mimeType } = dataUrlToBuffer(input.imageUrl);

        const timestamp = new Date().toISOString().split('T')[0];
        const finalFileName = `quadros-${input.type}-${input.frameType}-${timestamp}-${input.fileName}`;

        console.log(`[Drive] Uploading ${finalFileName} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)...`);

        const result = await googleDriveService.uploadFile(
          accessToken,
          finalFileName,
          buffer,
          mimeType
        );

        return {
          success: true,
          fileId: result.id,
          fileName: result.name,
          webViewLink: result.webViewLink,
        };
      } catch (error) {
        console.error('[Drive] Save error:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Falha ao salvar no Google Drive',
        });
      }
    }),

  listImages: protectedProcedure.query(async ({ ctx }) => {
    try {
      const accessToken = getUserAccessToken(ctx.user!.openId);
      const files = await googleDriveService.listFiles(accessToken);

      return {
        success: true,
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          webViewLink: f.webViewLink,
        })),
      };
    } catch (error) {
      console.error('[Drive] List error:', error);
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Falha ao listar arquivos do Google Drive',
      });
    }
  }),
});
