import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────────
// Schema Zod — espelho fiel do schema definido em generationRouter.ts
// Testamos a validação de input isoladamente, sem precisar de APIs externas
// ──────────────────────────────────────────────────────────────────────────────

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

const generateImagesInputSchema = z
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
  );

const checkVideoStatusSchema = z.object({
  operationId: z.string(),
});

// ──────────────────────────────────────────────────────────────────────────────

describe('generationRouter — validação de input (generateImages)', () => {
  it('aceita input válido completo com lifestyle', () => {
    const result = generateImagesInputSchema.safeParse({
      imageUrl: 'https://example.com/art.jpg',
      deliveryTypes: ['lifestyle', 'mockup'],
      frameType: 'black',
      roomType: 'office',
      styleType: 'mid_century_br',
    });
    expect(result.success).toBe(true);
  });

  it('aplica valores padrão quando campos opcionais são omitidos (sem lifestyle)', () => {
    const result = generateImagesInputSchema.safeParse({
      imageUrl: 'https://example.com/art.jpg',
      deliveryTypes: ['mockup'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.frameType).toBe('light_wood');
    }
  });

  it('rejeita URL de imagem inválida', () => {
    const result = generateImagesInputSchema.safeParse({
      imageUrl: 'nao-e-uma-url',
      deliveryTypes: ['mockup'],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita quando imageUrl está ausente', () => {
    const result = generateImagesInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejeita deliveryType inválido', () => {
    const result = generateImagesInputSchema.safeParse({
      imageUrl: 'https://example.com/art.jpg',
      deliveryTypes: ['lifestyle', 'banner'],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita frameType inválido', () => {
    const result = generateImagesInputSchema.safeParse({
      imageUrl: 'https://example.com/art.jpg',
      deliveryTypes: ['mockup'],
      frameType: 'wood',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita roomType inválido', () => {
    const result = generateImagesInputSchema.safeParse({
      imageUrl: 'https://example.com/art.jpg',
      deliveryTypes: ['lifestyle'],
      roomType: 'garage',
      styleType: 'scandinavian',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita styleType inválido', () => {
    const result = generateImagesInputSchema.safeParse({
      imageUrl: 'https://example.com/art.jpg',
      deliveryTypes: ['lifestyle'],
      roomType: 'living_room',
      styleType: 'tropical',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita lifestyle sem roomType', () => {
    const result = generateImagesInputSchema.safeParse({
      imageUrl: 'https://example.com/art.jpg',
      deliveryTypes: ['lifestyle'],
      styleType: 'scandinavian',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita lifestyle sem styleType', () => {
    const result = generateImagesInputSchema.safeParse({
      imageUrl: 'https://example.com/art.jpg',
      deliveryTypes: ['lifestyle'],
      roomType: 'living_room',
    });
    expect(result.success).toBe(false);
  });

  it('aceita mockup-only sem roomType nem styleType', () => {
    const result = generateImagesInputSchema.safeParse({
      imageUrl: 'https://example.com/art.jpg',
      deliveryTypes: ['mockup'],
      frameType: 'light_wood',
    });
    expect(result.success).toBe(true);
  });

  it('aceita todas as 4 molduras válidas', () => {
    for (const frameType of FRAME_TYPES) {
      const result = generateImagesInputSchema.safeParse({
        imageUrl: 'https://example.com/art.jpg',
        deliveryTypes: ['mockup'],
        frameType,
      });
      expect(result.success).toBe(true);
    }
  });

  it('aceita todos os 7 cômodos válidos', () => {
    for (const roomType of ROOM_TYPES) {
      const result = generateImagesInputSchema.safeParse({
        imageUrl: 'https://example.com/art.jpg',
        deliveryTypes: ['lifestyle'],
        roomType,
        styleType: 'scandinavian',
      });
      expect(result.success).toBe(true);
    }
  });

  it('aceita todos os 8 estilos válidos', () => {
    for (const styleType of STYLE_TYPES) {
      const result = generateImagesInputSchema.safeParse({
        imageUrl: 'https://example.com/art.jpg',
        deliveryTypes: ['lifestyle'],
        roomType: 'living_room',
        styleType,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('generationRouter — validação de input (checkVideoStatus)', () => {
  it('aceita operationId válido', () => {
    const result = checkVideoStatusSchema.safeParse({ operationId: 'op-123abc' });
    expect(result.success).toBe(true);
  });

  it('rejeita quando operationId está ausente', () => {
    const result = checkVideoStatusSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejeita quando operationId não é string', () => {
    const result = checkVideoStatusSchema.safeParse({ operationId: 12345 });
    expect(result.success).toBe(false);
  });
});
