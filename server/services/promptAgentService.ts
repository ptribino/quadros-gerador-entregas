import fs from 'fs';
import path from 'path';

type DeliveryType = 'lifestyle' | 'mockup' | 'video';
type FrameType = 'light_wood' | 'dark_wood' | 'white' | 'black';
type RoomType =
  | 'living_room'
  | 'bedroom'
  | 'kids_room'
  | 'office'
  | 'kitchen'
  | 'bathroom'
  | 'gourmet_area';
type StyleType =
  | 'scandinavian'
  | 'japandi'
  | 'minimalist'
  | 'boho'
  | 'classic'
  | 'contemporary'
  | 'industrial'
  | 'rustic';

interface PromptVariation {
  type: DeliveryType;
  frameType: FrameType;
  /** Cômodo onde o quadro será exibido — só relevante para lifestyle. */
  roomType?: RoomType;
  /** Estilo de decoração do ambiente — só relevante para lifestyle. */
  styleType?: StyleType;
  prompt: string;
}

const FRAMES: readonly FrameType[] = ['light_wood', 'dark_wood', 'white', 'black'];
const ROOMS: readonly RoomType[] = [
  'living_room',
  'bedroom',
  'kids_room',
  'office',
  'kitchen',
  'bathroom',
  'gourmet_area',
];
const STYLES: readonly StyleType[] = [
  'scandinavian',
  'japandi',
  'minimalist',
  'boho',
  'classic',
  'contemporary',
  'industrial',
  'rustic',
];

const FRAME_DESCRIPTIONS: Record<FrameType, string> = {
  light_wood: 'natural light oak wood',
  dark_wood: 'dark walnut wood with a rich espresso brown finish',
  white: 'painted matte white with a clean smooth finish',
  black: 'painted matte black with a clean smooth finish',
};

/**
 * Descrição-base do cômodo: foco em mobiliário e elementos físicos do espaço,
 * sem cores ou estética (que vêm do STYLE).
 */
const ROOM_DESCRIPTIONS: Record<RoomType, string> = {
  living_room:
    'a residential living room with a comfortable sofa, a coffee table, an area rug, a side lamp, and a large window providing natural daylight',
  bedroom:
    "a primary bedroom with a queen bed dressed in crisp linens, two bedside tables with reading lamps, a small bench at the foot of the bed, and sheer curtains diffusing soft daylight",
  kids_room:
    "a children's bedroom with a low single bed dressed in cheerful linens, a few plush toys, a small bookshelf with picture books, a play rug, and sheer curtains diffusing soft daylight",
  office:
    'a home or executive office with a clean wooden desk, an ergonomic chair, organized shelves with books and a small potted plant, and a large window with soft natural light filtering through blinds',
  kitchen:
    'an open kitchen and dining area with a wooden dining table and four chairs, ceramic tableware, a fresh fruit bowl on the table, kitchen cabinets visible in the background, a pendant light above the table, and warm natural daylight from a side window',
  bathroom:
    'a residential powder room (lavabo) with a stone or wooden vanity, an undermount basin, a wall-mounted decorative mirror, neatly folded hand towels, a small potted plant, and a warm overhead light',
  gourmet_area:
    'an outdoor covered gourmet area with a built-in grill or pizza oven, a long dining table with chairs, a ceiling fan above, potted plants along the perimeter, and warm afternoon light',
};

/**
 * Paleta e estética: cores, materiais, texturas, atmosfera. Aplicada por cima
 * da descrição de cômodo para compor "Sala no estilo Boho", "Quarto Japandi" etc.
 */
const STYLE_DESCRIPTIONS: Record<StyleType, string> = {
  scandinavian:
    'Scandinavian aesthetic: white plaster walls, light oak or pale pine flooring, raw linen and wool textiles in warm whites, a neutral palette accented with sage green and dried pampas, minimalist decor, lived-in but uncluttered',
  japandi:
    'Japandi aesthetic: warm muted palette of taupe, warm white and soft black, low-profile wooden furniture, raw linen and undyed cotton, a single bonsai or ikebana arrangement, wabi-sabi imperfection, restrained zen calm',
  minimalist:
    'Minimalist aesthetic: monochrome whites and soft cool grays, clean architectural lines, almost no decor, pale wood or polished concrete floor, abundant negative space, gallery-like serenity',
  boho:
    'Boho aesthetic: warm earthy palette of terracotta, rust, mustard and cream, rattan and macramé accents, layered patterned rugs, hanging plants and dried flowers, vintage textiles, lived-in eclectic mix',
  classic:
    'Classic aesthetic: refined cream and beige palette, traditional crown moldings, dark hardwood floors, upholstered furniture in tufted velvet, brass accents, framed art arranged with formal symmetry',
  contemporary:
    'Contemporary aesthetic: cool neutral palette with white walls, light concrete or pale wood floor, low-profile modular furniture in light gray, a fiddle leaf fig in a matte ceramic planter, soft diffused window light, upscale residential feel',
  industrial:
    'Industrial aesthetic: exposed brick walls and visible black steel structural beams, polished concrete floor, matte black metal fixtures, vintage Edison bulbs, leather and reclaimed wood furniture, raw and unpolished',
  rustic:
    'Rustic aesthetic: warm wood-clad walls or visible ceiling beams, woven wool throws, terracotta and amber palette, a vintage iron lantern, handcrafted ceramics, cozy farmhouse coziness',
};

const ARTWORK_FIDELITY = [
  'CRITICAL — ABSOLUTE FIDELITY TO THE UPLOADED ARTWORK:',
  'The uploaded image is the artwork that will be placed inside the frame.',
  'You MUST reproduce it EXACTLY as provided — identical composition, identical colors, identical lines, identical details, identical proportions.',
  'Do NOT alter, reinterpret, stylize, recolor, recrop, simplify, redraw or change the artwork in ANY way.',
  'The artwork inside the frame must look pixel-faithful to the reference image.',
].join(' ');

// Para mockup e vídeo continuamos lendo do .md (textos longos, escritos à mão).
type PromptKey = string;

class PromptAgentService {
  private prompts: Map<PromptKey, string> = new Map();

  constructor() {
    this.loadMarkdownPrompts();
  }

  /**
   * Carrega prompts de mockup e vídeo do prompts_gerados.md.
   * Lifestyle não está mais no .md — é gerado programaticamente em buildLifestylePrompt
   * porque temos 7 cômodos × 8 estilos × 4 molduras = 224 combinações.
   */
  private loadMarkdownPrompts() {
    try {
      const filePath = path.resolve(process.cwd(), 'prompts_gerados.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      const sections = content.split(/^## /m).filter(Boolean);

      for (const section of sections) {
        const lines = section.trim().split('\n');
        const title = lines[0].trim();
        const promptText = lines.slice(1).join('\n').trim();

        if (!promptText) continue;

        const key = this.parseTitle(title);
        if (key) this.prompts.set(key, promptText);
      }

      console.log(`[PromptAgent] Loaded ${this.prompts.size} mockup/video prompts from .md`);
    } catch (error) {
      console.error('[PromptAgent] Error loading prompts file:', error);
    }

    this.fillMissingMockupAndVideo();
  }

  private parseTitle(title: string): string | null {
    const FRAME_LABEL_TO_SLUG: ReadonlyArray<readonly [string, FrameType]> = [
      ['Amadeirado Claro', 'light_wood'],
      ['Amadeirado Escuro', 'dark_wood'],
      ['Branca', 'white'],
      ['Preta', 'black'],
    ];

    const frameMatch = FRAME_LABEL_TO_SLUG.find(([label]) => title.includes(label));
    if (!frameMatch) return null;
    const [, frameSlug] = frameMatch;

    if (title.startsWith('Mockup')) return `mockup-${frameSlug}`;
    if (title.startsWith('Vídeo')) return `video-${frameSlug}`;
    return null;
  }

  private fillMissingMockupAndVideo() {
    for (const frame of FRAMES) {
      const mockupKey = `mockup-${frame}`;
      if (!this.prompts.has(mockupKey)) {
        this.prompts.set(mockupKey, this.buildMockupPrompt(frame));
      }
      const videoKey = `video-${frame}`;
      if (!this.prompts.has(videoKey)) {
        this.prompts.set(videoKey, this.buildVideoPrompt(frame));
      }
    }
  }

  private buildLifestylePrompt(frame: FrameType, room: RoomType, style: StyleType): string {
    return [
      `${STYLE_DESCRIPTIONS[style]} applied to ${ROOM_DESCRIPTIONS[room]}.`,
      `Editorial interior photography, eye-level wide shot, 35mm lens, shallow depth of field, photorealistic. Lived-in authentic feel — not a photoshoot, not a showroom.`,
      `Place the framed print prominently on the main wall of the scene, hung at appropriate eye-level height for the room.`,
      `Frame: thin, ${FRAME_DESCRIPTIONS[frame]}.`,
      ARTWORK_FIDELITY,
      `Aspect ratio 4:5.`,
    ].join(' ');
  }

  private buildMockupPrompt(frame: FrameType): string {
    return [
      `Clean e-commerce product mockup. Place the framed print on a plain white or very light gray wall. Frame: thin ${FRAME_DESCRIPTIONS[frame]} with white mat border. Straight frontal view, perfectly centered. Soft uniform studio lighting, no harsh shadows, no reflections on glass. Minimalist product photography style.`,
      ARTWORK_FIDELITY,
      `Aspect ratio 4:5.`,
    ].join(' ');
  }

  private buildVideoPrompt(frame: FrameType): string {
    return [
      `Use the uploaded image as the scene reference.`,
      ARTWORK_FIDELITY,
      `The framed artwork must remain identical to the reference image throughout the entire video — same colors, composition and details in every frame. Do not alter the artwork at any point.`,
      `Opening scene: young Brazilian woman, dark hair, 25–35 years old, casual linen outfit in neutral ivory tones, natural makeup, hanging the framed artwork shown in the reference image on a white wall, arms raised, satisfied expression, warm natural window light from left, candid authentic lifestyle moment, real home feel, not a photoshoot.`,
      `Then camera slowly pulls back and pans to show the framed artwork directly from the front, full frame, centered on the wall, artwork clearly visible and identical to the reference image, no person in frame, soft even lighting, clean editorial product shot.`,
      `Frame: thin ${FRAME_DESCRIPTIONS[frame]}. Style: photorealistic, cinematic, editorial home decor, smooth camera motion, warm natural light throughout. Duration: 8 seconds. Aspect ratio: 16:9.`,
    ].join(' ');
  }

  /**
   * Obtém o prompt para a combinação de parâmetros.
   * Lifestyle precisa de room + style. Mockup/video usam só frame.
   */
  getPrompt(
    deliveryType: 'mockup' | 'video',
    frameType: FrameType,
  ): string;
  getPrompt(
    deliveryType: 'lifestyle',
    frameType: FrameType,
    roomType: RoomType,
    styleType: StyleType,
  ): string;
  getPrompt(
    deliveryType: DeliveryType,
    frameType: FrameType,
    roomType?: RoomType,
    styleType?: StyleType,
  ): string {
    if (deliveryType === 'lifestyle') {
      if (!roomType || !styleType) {
        throw new Error('lifestyle requires roomType and styleType');
      }
      return this.buildLifestylePrompt(frameType, roomType, styleType);
    }

    const key = `${deliveryType}-${frameType}`;
    const prompt = this.prompts.get(key);
    if (!prompt) {
      throw new Error(`Prompt not found for key: ${key}`);
    }
    return prompt;
  }

  /**
   * Constrói as variações para uma requisição específica do usuário.
   * Diferente da versão antiga, NÃO enumera todas as combinações possíveis
   * (seriam 7×8×4 = 224) — produz apenas o que o input pediu.
   */
  buildVariationsForRequest(input: {
    deliveryTypes: DeliveryType[];
    frameType: FrameType;
    roomType?: RoomType;
    styleType?: StyleType;
  }): PromptVariation[] {
    const variations: PromptVariation[] = [];

    for (const deliveryType of input.deliveryTypes) {
      if (deliveryType === 'lifestyle') {
        if (!input.roomType || !input.styleType) {
          throw new Error('lifestyle requires roomType and styleType in the request');
        }
        variations.push({
          type: 'lifestyle',
          frameType: input.frameType,
          roomType: input.roomType,
          styleType: input.styleType,
          prompt: this.getPrompt('lifestyle', input.frameType, input.roomType, input.styleType),
        });
      } else {
        variations.push({
          type: deliveryType,
          frameType: input.frameType,
          prompt: this.getPrompt(deliveryType, input.frameType),
        });
      }
    }

    return variations;
  }
}

export const promptAgentService = new PromptAgentService();
export { FRAMES, ROOMS, STYLES };
export type { FrameType, RoomType, StyleType, DeliveryType, PromptVariation };
