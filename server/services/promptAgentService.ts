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
  | 'mid_century_br'
  | 'brazilian_modern';

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
  'mid_century_br',
  'brazilian_modern',
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
  mid_century_br:
    'Mid-century Brazilian aesthetic (Sérgio Rodrigues / Joaquim Tenreiro / São Paulo 1960s school): warm dark jacaranda or rosewood furniture, aged caramel leather armchairs, brass and gold accents, neutral cream and ochre palette punctuated with deep emerald green or burnt orange, geometric Brazilian modernist objects, vintage textured rug, sophisticated curated heritage feel',
  brazilian_modern:
    'Brazilian modernist aesthetic inspired by Niemeyer and Lina Bo Bardi: polished concrete or pale cement floors, generous openings flooded with natural light, light tropical wood furniture, large tropical plants (Monstera/costela-de-adão, palm leaves, philodendron), warm white and ochre palette with lush deep green accents, breathable spacious feel rooted in tropical modernism',
};

const ARTWORK_FIDELITY = [
  'CRITICAL — ABSOLUTE FIDELITY TO THE UPLOADED ARTWORK:',
  'The uploaded image is the artwork that will be placed inside the frame.',
  'You MUST reproduce it EXACTLY as provided — identical composition, identical colors, identical lines, identical details, identical proportions.',
  'Do NOT alter, reinterpret, stylize, recolor, recrop, simplify, redraw or change the artwork in ANY way.',
  'The artwork inside the frame must look pixel-faithful to the reference image.',
].join(' ');

// Material/finish constraints — aplicado em TODO prompt (lifestyle, mockup, vídeo).
// Os quadros são impressos em papel sublimado fosco; nunca tem vidro.
const FINISH_CONSTRAINTS = [
  'MATERIAL: Print is on matte sublimation paper (no canvas, no glossy varnish).',
  'NO GLASS: the frame has NO glass overlay, NO acrylic, NO clear cover of any kind.',
  'NO REFLECTIONS: no specular highlights, no glare, no shiny surface on the artwork.',
  // Phrased positively because the model was ignoring the negative "no mat border"
  // version and still painting a thin white inner border (filete/passe-partout).
  // Describe the desired construction first, then reinforce with constraints.
  'FRAME CONSTRUCTION: The printed artwork fills the entire frame opening, edge-to-edge with the wood molding. The inner edge of the wood touches the printed image directly with zero gap. Frame opening dimensions equal the print dimensions exactly. Contemporary frameless gallery look. No spacer, no mat board, no inner white border, no passe-partout, no white trim line between the print and the wood.',
].join(' ');

/**
 * Para cada estilo, as molduras que harmonizam visualmente. Usado pelo
 * pipeline do catálogo pra sortear UMA moldura coerente com o estilo
 * sorteado, em vez de combinar aleatoriamente todos os 4 frames com todos
 * os 8 estilos (algumas combinações ficam estranhas — ex: industrial com
 * moldura branca).
 */
const FRAME_AFFINITY: Record<StyleType, readonly FrameType[]> = {
  scandinavian: ['light_wood', 'white'],
  japandi: ['light_wood', 'dark_wood', 'black'],
  minimalist: ['white', 'black'],
  boho: ['dark_wood', 'light_wood'],
  classic: ['dark_wood', 'black'],
  contemporary: ['black', 'white', 'light_wood'],
  mid_century_br: ['dark_wood', 'black'],
  brazilian_modern: ['light_wood', 'dark_wood'],
};

export function framesForStyle(style: StyleType): readonly FrameType[] {
  return FRAME_AFFINITY[style];
}

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
      // Visual style — alinhado com fotos do goquadros.com.br: editorial real,
      // não pode ter cara de AI/CG. Cores ricas, deep focus, luz direcional.
      `Indistinguishable from a professional editorial interior shoot for a premium decor brand (reference: goquadros.com.br). MUST NOT look AI-generated, MUST NOT look 3D-rendered or CG. Photographic realism with crisp focus and natural film-like quality.`,
      `Lighting: warm golden directional sunlight entering through a window, casting crisp soft shadows on the floor and adjacent surfaces. Avoid flat ambient lighting and avoid window overexposure — keep the highlights controlled.`,
      `Color and depth: vivid saturated natural colors with rich contrast, deep tonal range (true blacks, clean whites), every plane crisp and in focus throughout the scene — deep focus, no shallow depth of field, no blurry background.`,
      `Composition: 35mm lens, frontal shot tilted slightly upward so the wall and the framed artwork dominate the upper two-thirds of the image. Minimize floor visibility — show only the lower 20-25% of the image as floor/furniture base, just enough to ground the scene. NEVER let furniture, floor or props take more space than the artwork.`,
      `Curated decor (small and supporting): a ceramic vase, a stack of design books, fresh greenery, woven textures, refined objects — placed at the artwork's base, not competing with it. No wide-angle pull-back showing entire rooms.`,
      `The LARGE framed print is the absolute visual anchor, hung prominently centered on the main wall and occupying 45-60% of the wall height. It dominates the composition unmistakably — the eye goes to the artwork first, every other element supports it.`,
      `Frame: thin, ${FRAME_DESCRIPTIONS[frame]}, intentionally chosen to harmonize with the room's palette and decor.`,
      FINISH_CONSTRAINTS,
      ARTWORK_FIDELITY,
      `Aspect ratio 4:5.`,
    ].join(' ');
  }

  private buildMockupPrompt(frame: FrameType): string {
    return [
      `Clean e-commerce product mockup. LARGE framed print centered on a plain off-white or very light warm gray wall, occupying the majority of the visible composition so the artwork dominates the frame.`,
      `Frame: thin ${FRAME_DESCRIPTIONS[frame]} molding, with the printed artwork mounted flush against the inner edge of the wood. The print extends from one inner edge of the frame to the other with zero gap — wood touches print directly on all four sides.`,
      FINISH_CONSTRAINTS,
      `Straight frontal view, perfectly centered. Soft uniform studio lighting from the front-left, very subtle shadow on the right side to give depth, no harsh shadows. Minimalist premium product photography.`,
      ARTWORK_FIDELITY,
      `Aspect ratio 4:5.`,
    ].join(' ');
  }

  private buildVideoPrompt(frame: FrameType): string {
    return [
      `Use the uploaded image as the scene reference.`,
      ARTWORK_FIDELITY,
      FINISH_CONSTRAINTS,
      `The LARGE framed artwork is the focal point and must remain identical to the reference image throughout the entire video — same colors, composition and details in every frame. Do not alter the artwork at any point.`,
      `Opening scene: young Brazilian woman, dark hair, 25–35 years old, casual linen outfit in neutral ivory tones, natural makeup, hanging the framed artwork shown in the reference image on a wall, arms raised, satisfied expression, warm golden sunlight streaming through a side window, candid authentic lifestyle moment, real refined home feel, not a photoshoot.`,
      `Then camera slowly pulls back and pans to show the framed artwork directly from the front, large and centered on the wall as the visual anchor, artwork clearly visible and identical to the reference image, no person in frame, soft even lighting, clean editorial product shot.`,
      `Frame: thin ${FRAME_DESCRIPTIONS[frame]}, harmonized with the room's palette. Style: photorealistic, cinematic, refined editorial home decor, smooth camera motion, warm natural light throughout. Duration: 8 seconds. Aspect ratio: 16:9.`,
    ].join(' ');
  }

  /**
   * Variante do lifestyle em 16:9 — usada no still inicial do pipeline de
   * vídeo (Imagen gera a cena estática e o Veo só aplica movimento de câmera).
   * Garante que o still herda TODAS as regras do lifestyle (quadro grande,
   * sublimado matte, sem vidro, deep focus, editorial não-AI) em vez de cair
   * em prompt hardcoded.
   */
  buildLifestyleStill16x9(frame: FrameType, room: RoomType, style: StyleType): string {
    return this.buildLifestylePrompt(frame, room, style).replace(
      'Aspect ratio 4:5.',
      'Aspect ratio 16:9.',
    );
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
