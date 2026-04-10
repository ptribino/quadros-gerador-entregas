import { ENV } from '../_core/env';

// ============================================================
// Google Gemini 2.5 Flash Image — image generation with reference
// Uses gemini-2.5-flash-image model via generateContent endpoint
// ============================================================

export interface ImagenGenerationRequest {
  prompt: string;
  referenceImageUrl?: string;
  numImages?: number;
  aspectRatio?: '1:1' | '3:4' | '4:3' | '16:9' | '9:16';
}

export interface ImagenGenerationResponse {
  id: string;
  status: 'completed' | 'failed';
  images: Array<{
    url: string;
    id: string;
    mimeType: string;
    b64Data?: string;
  }>;
  error?: string;
}

class GoogleImagenService {
  private apiKey: string;

  constructor() {
    this.apiKey = ENV.googleApiKey;
  }

  /**
   * Gera imagens usando Gemini 2.5 Flash Image via generateContent
   * Suporta imagem de referência nativa (multimodal input)
   */
  async generateImages(request: ImagenGenerationRequest): Promise<ImagenGenerationResponse> {
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY is not configured. Set it in your .env file.');
    }

    try {
      const model = 'gemini-2.5-flash-image';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

      // Monta as parts: imagem de referência (se houver) + prompt de texto
      const parts: Array<Record<string, unknown>> = [];

      if (request.referenceImageUrl) {
        const { base64, mimeType } = this.extractImageData(request.referenceImageUrl);
        console.log(`[GeminiImage] Reference image: mimeType=${mimeType}, base64 length=${base64.length}`);
        parts.push({
          inlineData: {
            mimeType,
            data: base64,
          },
        });
      }

      parts.push({
        text: request.prompt,
      });

      const payload = {
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      };

      console.log(`[GeminiImage] Generating with model ${model}...`);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[GeminiImage] API error: ${errorText}`);
        throw new Error(`Google Gemini API error (${response.status}): ${errorText}`);
      }

      const result = await response.json() as {
        candidates?: Array<{
          content: {
            parts: Array<{
              text?: string;
              inlineData?: {
                mimeType: string;
                data: string;
              };
            }>;
          };
        }>;
      };

      const images: Array<{ url: string; id: string; mimeType: string; b64Data: string }> = [];

      if (result.candidates) {
        for (const candidate of result.candidates) {
          for (const part of candidate.content.parts) {
            if (part.inlineData) {
              const id = `gemini-${Date.now()}-${images.length}`;
              images.push({
                id,
                url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                mimeType: part.inlineData.mimeType,
                b64Data: part.inlineData.data,
              });
            }
          }
        }
      }

      console.log(`[GeminiImage] Generated ${images.length} image(s) successfully`);

      return {
        id: `gen-${Date.now()}`,
        status: images.length > 0 ? 'completed' : 'failed',
        images,
        error: images.length === 0 ? 'No images were generated' : undefined,
      };
    } catch (error) {
      console.error('[GeminiImage] Generation error:', error);
      return {
        id: `gen-${Date.now()}`,
        status: 'failed',
        images: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Extrai base64 e mimeType de uma data URL ou faz fetch de URL externa
   */
  private extractImageData(imageUrl: string): { base64: string; mimeType: string } {
    if (imageUrl.startsWith('data:')) {
      const mimeMatch = imageUrl.match(/^data:([^;]+);base64,/);
      const mimeType = mimeMatch?.[1] || 'image/png';
      const base64Part = imageUrl.split(',')[1];
      if (base64Part) return { base64: base64Part, mimeType };
      throw new Error('Invalid data URL: no base64 content');
    }
    throw new Error('Only data URLs are supported. Upload the image first.');
  }

  async validateApiKey(): Promise<boolean> {
    if (!this.apiKey) return false;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const googleImagenService = new GoogleImagenService();
