import { ENV } from '../_core/env';

// ============================================================
// Google Gemini 3.1 Flash Image — image generation with reference
// Uses gemini-3.1-flash-image model via generateContent endpoint
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

// ============================================================
// Gemini Batch API — geração assíncrona em lote (50% mais barata que
// generateContent, mesmo modelo). Usada pela fila de geração do catálogo
// (server/_core/catalogWorker.ts). NÃO usada pelo fluxo manual "Gerar
// variações" (generationRouter.ts), que continua síncrono via generateImages.
// ============================================================

export interface BatchImageRequest {
  /** Chave única da request dentro do lote — usada pra casar o resultado de volta à task. */
  key: string;
  prompt: string;
  referenceImageB64?: string;
  referenceMimeType?: string;
  aspectRatio?: '1:1' | '3:4' | '4:3' | '16:9' | '9:16';
}

export interface BatchSubmitResult {
  /** Nome do job no formato "batches/xxxx", usado pra consultar o status depois. */
  batchName: string;
}

export type BatchState =
  | 'BATCH_STATE_PENDING'
  | 'BATCH_STATE_RUNNING'
  | 'BATCH_STATE_SUCCEEDED'
  | 'BATCH_STATE_FAILED'
  | 'BATCH_STATE_CANCELLED'
  | 'BATCH_STATE_EXPIRED';

export interface BatchResultItem {
  key: string;
  b64Data?: string;
  mimeType?: string;
  error?: string;
}

export interface BatchStatus {
  state: BatchState;
  /** Só populado quando state === BATCH_STATE_SUCCEEDED (resultados inline). */
  results?: BatchResultItem[];
}

class GoogleImagenService {
  private apiKey: string;

  constructor() {
    this.apiKey = ENV.googleApiKey;
  }

  /**
   * Gera imagens usando Gemini 3.1 Flash Image via generateContent
   * Suporta imagem de referência nativa (multimodal input)
   */
  async generateImages(request: ImagenGenerationRequest): Promise<ImagenGenerationResponse> {
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY is not configured. Set it in your .env file.');
    }

    try {
      const model = 'gemini-3.1-flash-image';
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
          // Antes esse campo era só decorativo — a proporção real dependia
          // 100% do modelo interpretar a frase "Aspect ratio X:Y." no prompt.
          // O Gemini image model aceita esse aspect ratio como parâmetro de
          // fato (não só sugestão textual), então aplicamos aqui também.
          ...(request.aspectRatio ? { imageConfig: { aspectRatio: request.aspectRatio } } : {}),
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

  /**
   * Submete um lote de gerações de imagem via Gemini Batch API (inline,
   * até ~20MB de payload total — quem chama é responsável por não passar
   * disso, ver MAX_BATCH_PAYLOAD_BYTES em catalogWorker.ts).
   */
  async submitBatch(requests: BatchImageRequest[], displayName: string): Promise<BatchSubmitResult> {
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY is not configured. Set it in your .env file.');
    }
    if (requests.length === 0) {
      throw new Error('submitBatch chamado sem requests');
    }

    const model = 'gemini-3.1-flash-image';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchGenerateContent?key=${this.apiKey}`;

    const batchRequests = requests.map((req) => {
      const parts: Array<Record<string, unknown>> = [];
      if (req.referenceImageB64) {
        parts.push({
          inlineData: {
            mimeType: req.referenceMimeType || 'image/jpeg',
            data: req.referenceImageB64,
          },
        });
      }
      parts.push({ text: req.prompt });

      return {
        request: {
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            ...(req.aspectRatio ? { imageConfig: { aspectRatio: req.aspectRatio } } : {}),
          },
        },
        metadata: { key: req.key },
      };
    });

    const payload = {
      batch: {
        displayName,
        inputConfig: {
          requests: { requests: batchRequests },
        },
      },
    };

    console.log(`[GeminiBatch] Submetendo lote "${displayName}" com ${requests.length} request(s)...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GeminiBatch] Erro ao submeter: ${errorText}`);
      throw new Error(`Google Gemini Batch submit error (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as { name: string };
    console.log(`[GeminiBatch] Lote submetido como ${result.name}`);
    return { batchName: result.name };
  }

  /**
   * Consulta o status de um job de batch. Só retorna `results` quando o
   * job está SUCCEEDED (resultados inline, casados por `key`).
   *
   * Nota: o formato exato de um item individual com erro dentro de um job
   * SUCCEEDED é inferido (não observado em teste real) — trata qualquer
   * item sem imagem em `response.candidates` como falha daquela request
   * específica, sem derrubar o job inteiro.
   */
  async getBatch(batchName: string): Promise<BatchStatus> {
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY is not configured. Set it in your .env file.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/${batchName}?key=${this.apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Gemini Batch status error (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as {
      metadata?: {
        state?: BatchState;
        output?: {
          inlinedResponses?: {
            inlinedResponses?: Array<{
              metadata?: { key?: string };
              response?: {
                candidates?: Array<{
                  content: {
                    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
                  };
                }>;
              };
              error?: { message?: string };
            }>;
          };
        };
      };
    };

    const state = result.metadata?.state ?? 'BATCH_STATE_PENDING';
    if (state !== 'BATCH_STATE_SUCCEEDED') {
      return { state };
    }

    const items = result.metadata?.output?.inlinedResponses?.inlinedResponses ?? [];
    const results: BatchResultItem[] = items.map((item) => {
      const key = item.metadata?.key ?? '';
      const imagePart = item.response?.candidates?.[0]?.content.parts.find((p) => p.inlineData);
      if (imagePart?.inlineData) {
        return { key, b64Data: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType };
      }
      return { key, error: item.error?.message ?? 'Nenhuma imagem retornada para essa request' };
    });

    return { state, results };
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
