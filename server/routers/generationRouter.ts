import { z } from 'zod';
import { publicProcedure, router } from '../_core/trpc';
import { promptAgentService } from '../services/promptAgentService';
import { googleImagenService } from '../services/freepikService';
import { googleVeoService } from '../services/googleVeoService';
import { TRPCError } from '@trpc/server';

const FRAME_TYPES = ['light_wood', 'dark_wood', 'white', 'black'] as const;
const ROOM_TYPES = [
  'living_room',
  'bedroom',
  'kids_room',
  'office',
  'kitchen',
  'bathroom',
  'gourmet_area',
] as const;
const STYLE_TYPES = [
  'scandinavian',
  'japandi',
  'minimalist',
  'boho',
  'classic',
  'contemporary',
  'mid_century_br',
  'brazilian_modern',
] as const;

export const generationRouter = router({
  /**
   * Gera imagens e vídeos usando Google Imagen + Veo
   * - Lifestyle & Mockup: Google Imagen 3
   * - Vídeo Lifestyle: Google Veo
   */
  generateImages: publicProcedure
    .input(
      z
        .object({
          imageUrl: z.string().url('URL da imagem inválida'),
          deliveryTypes: z
            .array(z.enum(['lifestyle', 'mockup', 'video']))
            .default(['lifestyle', 'mockup', 'video']),
          frameType: z.enum(FRAME_TYPES).default('light_wood'),
          roomType: z.enum(ROOM_TYPES).optional(),
          styleType: z.enum(STYLE_TYPES).optional(),
        })
        .refine(
          (data) => {
            const needsRoomStyle = data.deliveryTypes.some((t) => t === 'lifestyle' || t === 'video');
            return !needsRoomStyle || (!!data.roomType && !!data.styleType);
          },
          { message: 'roomType e styleType são obrigatórios para lifestyle e vídeo' },
        ),
    )
    .mutation(async ({ input }) => {
      try {
        const variations = promptAgentService.buildVariationsForRequest({
          deliveryTypes: input.deliveryTypes,
          frameType: input.frameType,
          roomType: input.roomType,
          styleType: input.styleType,
        });

        const generationResults = [];

        for (const promptVariation of variations) {
          try {
            if (promptVariation.type === 'video') {
              // PASSO 1: Gerar still 16:9 com Gemini Imagen.
              // Usa o MESMO prompt do lifestyle (incluindo room/style escolhidos
              // pelo usuário) — só muda pra 16:9. Sem isso, o still ignora a
              // categoria e cai sempre em "Scandinavian living room", o que
              // faz produto infantil aparecer em sala etc.
              if (!input.roomType || !input.styleType) {
                throw new Error('video requires roomType and styleType');
              }
              const stillPrompt = promptAgentService.buildLifestyleStill16x9(
                promptVariation.frameType,
                input.roomType,
                input.styleType,
              );

              console.log('[Generation] Step 1: Generating still frame with Gemini (preserving artwork fidelity)...');
              const stillImage = await googleImagenService.generateImages({
                prompt: stillPrompt,
                referenceImageUrl: input.imageUrl,
                numImages: 1,
                aspectRatio: '16:9',
              });

              if (!stillImage.images?.[0]?.url) {
                throw new Error('Falha ao gerar imagem base para o vídeo');
              }

              // PASSO 2: Enviar imagem gerada ao Veo como primeiro frame
              const veoMotionPrompt =
                'Subtle gentle animation. Slow camera push forward toward the framed artwork on the wall. Very soft ambient light flickering. The framed artwork on the wall must remain completely static and unchanged throughout the entire video. Cinematic, smooth, editorial.';

              console.log('[Generation] Step 2: Sending still frame to Veo (motion-only prompt)...');

              const result = await googleVeoService.generateVideo({
                prompt: veoMotionPrompt,
                referenceImageUrl: stillImage.images[0].url,
                durationSeconds: 6,
                aspectRatio: '16:9',
              });

              let videoResult = result;

              if (videoResult.status === 'processing' && videoResult.id) {
                console.log(`[Generation] Video operation started: ${videoResult.id}. Polling...`);
                const maxAttempts = 60;
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                  await new Promise((resolve) => setTimeout(resolve, 5000));
                  const status = await googleVeoService.checkGenerationStatus(videoResult.id);
                  console.log(`[Generation] Video poll #${attempt + 1}: status=${status.status}`);
                  if (status.status === 'completed' || status.status === 'failed') {
                    videoResult = status;
                    break;
                  }
                }
              }

              generationResults.push({
                type: promptVariation.type,
                frameType: promptVariation.frameType,
                roomType: promptVariation.roomType,
                styleType: promptVariation.styleType,
                prompt: promptVariation.prompt,
                generationId: videoResult.id,
                status: videoResult.status === 'processing' ? 'failed' : videoResult.status,
                images: videoResult.videoUrl ? [{ url: videoResult.videoUrl, id: videoResult.id }] : [],
                error:
                  videoResult.status === 'processing'
                    ? 'Vídeo demorou demais para gerar. Tente novamente.'
                    : videoResult.error,
              });
            } else {
              const result = await googleImagenService.generateImages({
                prompt: promptVariation.prompt,
                referenceImageUrl: input.imageUrl,
                numImages: 1,
                aspectRatio: '3:4',
              });

              generationResults.push({
                type: promptVariation.type,
                frameType: promptVariation.frameType,
                roomType: promptVariation.roomType,
                styleType: promptVariation.styleType,
                prompt: promptVariation.prompt,
                generationId: result.id,
                status: result.status,
                images: result.images.map((img) => ({ url: img.url, id: img.id })),
                error: result.error,
              });
            }
          } catch (error) {
            console.error(`[Generation] Error generating for ${promptVariation.type}:`, error);
            generationResults.push({
              type: promptVariation.type,
              frameType: promptVariation.frameType,
              roomType: promptVariation.roomType,
              styleType: promptVariation.styleType,
              prompt: promptVariation.prompt,
              generationId: '',
              status: 'failed',
              images: [],
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        return {
          success: true,
          results: generationResults,
          totalGenerated: generationResults.filter((r) => r.status !== 'failed').length,
        };
      } catch (error) {
        console.error('[Generation] Error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to generate',
        });
      }
    }),

  /**
   * Verifica o status de uma geração de vídeo (Veo é assíncrono)
   */
  checkVideoStatus: publicProcedure
    .input(
      z.object({
        operationId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      try {
        const status = await googleVeoService.checkGenerationStatus(input.operationId);
        return status;
      } catch (error) {
        console.error('[Generation] Video status check error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to check video generation status',
        });
      }
    }),

  /**
   * Valida a API key do Google
   */
  validateGoogleApiKey: publicProcedure.query(async () => {
    try {
      const isValid = await googleImagenService.validateApiKey();
      return { isValid };
    } catch (error) {
      console.error('[Generation] API key validation error:', error);
      return { isValid: false };
    }
  }),
});
