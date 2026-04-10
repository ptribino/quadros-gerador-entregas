import { z } from 'zod';
import { publicProcedure, router } from '../_core/trpc';
import { promptAgentService } from '../services/promptAgentService';
import { googleImagenService } from '../services/freepikService';
import { googleVeoService } from '../services/googleVeoService';
import { TRPCError } from '@trpc/server';

export const generationRouter = router({
  /**
   * Gera imagens e vídeos usando Google Imagen + Veo
   * - Lifestyle & Mockup: Google Imagen 3
   * - Vídeo Lifestyle: Google Veo
   */
  generateImages: publicProcedure
    .input(
      z.object({
        imageUrl: z.string().url('URL da imagem inválida'),
        deliveryTypes: z.array(z.enum(['lifestyle', 'mockup', 'video'])).default(['lifestyle', 'mockup', 'video']),
        frameType: z.enum(['pine', 'aluminum']).default('pine'),
        environmentType: z.enum(['scandinavian', 'modern']).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Usa prompts pré-cadastrados do arquivo prompts_gerados.md
        const allPrompts = promptAgentService.generatePromptVariations(input.deliveryTypes);

        // Filtra baseado no tipo de moldura e ambiente selecionados
        const filteredPrompts = allPrompts.filter((p) => {
          if (p.frameType !== input.frameType) return false;
          if (input.environmentType && p.type === 'lifestyle' && p.environmentType !== input.environmentType) return false;
          return true;
        });

        const generationResults = [];

        for (const promptVariation of filteredPrompts) {
          try {
            if (promptVariation.type === 'video') {
              // PASSO 1: Gerar imagem estática do ambiente com Gemini (fidelidade à arte original)
              const frameLabel = promptVariation.frameType === 'pine' ? 'natural pine wood' : 'matte black aluminum';
              const stillPrompt = `Generate a photorealistic wide shot (16:9) of this artwork displayed in a ${frameLabel} frame, hanging centered on a white wall in a bright Scandinavian living room. Below the frame there is a beige linen sofa. Warm natural window light from the left. The artwork in the frame must be EXACTLY as provided — do not alter, reinterpret or stylize it in any way. Reproduce every color, line and detail with absolute fidelity. Editorial interior photography, cinematic.`;

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
              // Prompt focado APENAS no movimento — NÃO descrever a cena (o Veo já vê a imagem)
              const veoMotionPrompt = 'Subtle gentle animation. Slow camera push forward toward the framed artwork on the wall. Very soft ambient light flickering. The framed artwork on the wall must remain completely static and unchanged throughout the entire video. Cinematic, smooth, editorial.';

              console.log('[Generation] Step 2: Sending still frame to Veo (motion-only prompt)...');

              const result = await googleVeoService.generateVideo({
                prompt: veoMotionPrompt,
                referenceImageUrl: stillImage.images[0].url,
                durationSeconds: 6,
                aspectRatio: '16:9',
              });

              let videoResult = result;

              // Se está processando, faz polling até completar (máx 5 minutos)
              if (videoResult.status === 'processing' && videoResult.id) {
                console.log(`[Generation] Video operation started: ${videoResult.id}. Polling...`);
                const maxAttempts = 60; // 60 x 5s = 5 minutos
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                  await new Promise(resolve => setTimeout(resolve, 5000)); // espera 5s
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
                environmentType: promptVariation.environmentType,
                prompt: promptVariation.prompt,
                generationId: videoResult.id,
                status: videoResult.status === 'processing' ? 'failed' : videoResult.status,
                images: videoResult.videoUrl ? [{ url: videoResult.videoUrl, id: videoResult.id }] : [],
                error: videoResult.status === 'processing' ? 'Vídeo demorou demais para gerar. Tente novamente.' : videoResult.error,
              });
            } else {
              // Gera imagem usando Google Imagen 3
              const result = await googleImagenService.generateImages({
                prompt: promptVariation.prompt,
                referenceImageUrl: input.imageUrl,
                numImages: 1,
                aspectRatio: '3:4',
              });

              generationResults.push({
                type: promptVariation.type,
                frameType: promptVariation.frameType,
                environmentType: promptVariation.environmentType,
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
              environmentType: promptVariation.environmentType,
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
      })
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
