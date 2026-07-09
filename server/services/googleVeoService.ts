import { ENV } from '../_core/env';

// ============================================================
// Google Veo — video generation for Vídeo Lifestyle
// ============================================================

export interface VeoGenerationRequest {
  prompt: string;
  referenceImageUrl?: string;
  durationSeconds?: number;
  aspectRatio?: '16:9' | '9:16' | '1:1';
}

export interface VeoGenerationResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}

class GoogleVeoService {
  private apiKey: string;

  constructor() {
    this.apiKey = ENV.googleApiKey;
  }

  /**
   * Gera vídeo usando Google Veo via Generative Language API
   * Model: veo-3.1-generate-preview
   */
  async generateVideo(request: VeoGenerationRequest): Promise<VeoGenerationResponse> {
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY is not configured. Set it in your .env file.');
    }

    try {
      const model = 'veo-3.1-generate-preview';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${this.apiKey}`;

      const instance: Record<string, unknown> = {
        prompt: request.prompt,
      };

      // Se uma imagem de referência for fornecida, inclui como primeiro frame
      if (request.referenceImageUrl) {
        const { base64, mimeType } = this.extractImageData(request.referenceImageUrl);
        console.log(`[GoogleVeo] Reference image: mimeType=${mimeType}, base64 length=${base64.length}`);
        instance.image = {
          bytesBase64Encoded: base64,
          mimeType: mimeType,
        };
      }

      const payload = {
        instances: [instance],
        parameters: {
          aspectRatio: request.aspectRatio || '16:9',
          durationSeconds: request.durationSeconds || 8,
          sampleCount: 1,
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Veo API error (${response.status}): ${errorText}`);
      }

      const result = await response.json() as {
        name?: string;
      };

      // Veo retorna uma operação assíncrona (long-running operation)
      const operationName = result.name;

      if (!operationName) {
        throw new Error('Veo API did not return an operation name');
      }

      return {
        id: operationName,
        status: 'processing',
      };
    } catch (error) {
      console.error('[GoogleVeo] Generation error:', error);
      return {
        id: `veo-${Date.now()}`,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Verifica o status de uma operação de geração de vídeo
   */
  async checkGenerationStatus(operationName: string): Promise<VeoGenerationResponse> {
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY is not configured.');
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${this.apiKey}`;

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Veo status check error (${response.status}): ${errorText}`);
      }

      const result = await response.json() as {
        done?: boolean;
        response?: {
          generateVideoResponse?: {
            generatedSamples?: Array<{
              video?: {
                uri?: string;
              };
            }>;
          };
        };
        error?: { message: string };
      };

      if (result.error) {
        return {
          id: operationName,
          status: 'failed',
          error: result.error.message,
        };
      }

      if (!result.done) {
        return {
          id: operationName,
          status: 'processing',
        };
      }

      const videoUri = result.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;

      if (!videoUri) {
        return {
          id: operationName,
          status: 'failed',
          error: 'Video URI not found in response',
        };
      }

      // Baixa o vídeo e converte para data URL (browser não acessa a URI diretamente)
      console.log(`[GoogleVeo] Downloading video from: ${videoUri}`);
      const videoDataUrl = await this.downloadVideoAsDataUrl(videoUri);

      return {
        id: operationName,
        status: 'completed',
        videoUrl: videoDataUrl,
      };
    } catch (error) {
      console.error('[GoogleVeo] Status check error:', error);
      return {
        id: operationName,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Baixa o vídeo da URI do Google e retorna como data URL para o browser reproduzir
   */
  private async downloadVideoAsDataUrl(videoUri: string): Promise<string> {
    // Adiciona API key à URI
    const separator = videoUri.includes('?') ? '&' : '?';
    const urlWithKey = `${videoUri}${separator}key=${this.apiKey}`;

    const response = await fetch(urlWithKey, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    console.log(`[GoogleVeo] Video downloaded: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB`);
    return `data:video/mp4;base64,${base64}`;
  }

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
}

export const googleVeoService = new GoogleVeoService();
