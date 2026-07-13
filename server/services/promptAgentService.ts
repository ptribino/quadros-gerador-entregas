import fs from 'fs';
import path from 'path';
import type { Orientation } from '../_core/orientation';

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
  | 'goquadros_signature'
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
  'goquadros_signature',
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
    'a bright dining nook with the edge of a wooden dining table and simple ceramic tableware, kitchen cabinetry visible softly out of focus in the background, a pendant light above the table, and warm natural daylight from a side window',
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
  // Identidade única da marca GoQuadros (goquadros.com.br) — usado como padrão
  // no sortimento automático do catálogo pra manter o visual coeso entre
  // produtos, em vez de cada um cair num estilo decorativo diferente.
  goquadros_signature:
    'GoQuadros signature aesthetic: warm cream and soft beige walls, mid-tone natural wood furniture (never dark jacaranda, never glossy painted pieces), a warm ivory and sand color palette with gentle neutral undertones, one single well-chosen decor accent nearby (a ceramic vase, a small stack of books, or dried pampas grass) and nothing else — never cluttered, never eclectic, always calm and refined, upscale residential feel consistent with premium Brazilian home-décor retail photography',
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

// Aplicado em TODO prompt que gera imagem/vídeo — sem isso o modelo já
// chegou a desenhar "GOQUADROS" escrito na parede da cena (interpretou uma
// referência de marca no prompt como texto pra renderizar). Nunca pode
// acontecer de novo.
const NO_TEXT_CONSTRAINT = [
  'CRITICAL — ABSOLUTELY NO TEXT ANYWHERE IN THE IMAGE:',
  'Do not render any text, letters, words, numbers, logos, watermarks, signatures, captions, or brand names anywhere in the scene — not on the wall, not on the frame, not on the floor, not on any object, not as an overlay.',
  'The ONLY exception is text that is already part of the uploaded artwork itself (e.g. text printed inside the artwork) — reproduce that exactly as provided, but do NOT add any new text anywhere else.',
].join(' ');

// Usado quando a referência de entrada já É um mockup gerado (não a arte
// crua) — pede pro modelo repintar só a moldura, preservando ângulo, corte,
// luz e a renderização da arte. Evita que cada cor saia como uma foto
// diferente (câmera, crop e até a arte variando entre as 4 gerações).
const MOCKUP_RECOLOR_FIDELITY = [
  'This is a professional product photograph of a single framed print hanging on a wall — treat it as an EXACT visual reference, not inspiration.',
  'CRITICAL — PIXEL-IDENTICAL REPRODUCTION: reproduce every pixel of this photo exactly as it is — same camera angle, same distance, same crop, same wall, same shadow, same lighting, and the exact same printed artwork inside the frame, unchanged in any way (same colors, same composition, same details).',
  'CRITICAL — SAME FRAMING: the frame must occupy the EXACT same position, size and margins within the image as in the reference — same empty space on all four sides, same zoom level, same crop boundaries. Do NOT zoom in, zoom out, re-crop, recenter, or change how much of the wall is visible around the frame.',
  'Do NOT add, remove, resize, recrop, or move anything else in the photo.',
].join(' ');

// Aspecto da FOTO gerada por orientação do quadro. Retrato é o padrão
// histórico do catálogo (3:4); quadros horizontais (ex: obras clássicas tipo
// "Santa Ceia") precisam de foto larga (4:3) — senão a arte sai espremida ou
// cortada dentro de uma moldura vertical que não corresponde ao produto real.
const ASPECT_RATIO_BY_ORIENTATION: Record<Orientation, string> = {
  vertical: '3:4',
  horizontal: '4:3',
};

// Reforça pro modelo que a MOLDURA em si (não só a foto) deve ser larga —
// sem isso ele tende a desenhar uma moldura vertical mesmo numa foto 4:3.
const ORIENTATION_CLAUSE: Record<Orientation, string> = {
  vertical: 'The framed print is in a VERTICAL (portrait) orientation — taller than it is wide.',
  horizontal:
    'CRITICAL — HORIZONTAL FRAME: the framed print is in a HORIZONTAL (landscape) orientation — noticeably wider than it is tall. Do NOT rotate it, crop it into a square, or present it as a vertical/portrait frame.',
};

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
  // Estilo único de marca — combina com qualquer moldura do catálogo.
  goquadros_signature: ['light_wood', 'dark_wood', 'white', 'black'],
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

  private buildLifestylePrompt(
    frame: FrameType,
    room: RoomType,
    style: StyleType,
    orientation: Orientation = 'vertical',
  ): string {
    return [
      `${STYLE_DESCRIPTIONS[style]} applied to ${ROOM_DESCRIPTIONS[room]}.`,
      // Visual style — editorial real, não pode ter cara de AI/CG. Cores
      // ricas, deep focus, luz direcional. Sem citar marca/domínio aqui —
      // o modelo já chegou a desenhar "goquadros.com.br" como texto na
      // parede quando o nome aparecia no prompt.
      `Indistinguishable from a professional editorial interior shoot for a premium decor brand. MUST NOT look AI-generated, MUST NOT look 3D-rendered or CG. Photographic realism with crisp focus and natural film-like quality.`,
      `Lighting: warm golden directional sunlight entering through a window, casting crisp soft shadows on the floor and adjacent surfaces. Avoid flat ambient lighting and avoid window overexposure — keep the highlights controlled.`,
      `Color and depth: vivid saturated natural colors with rich contrast, deep tonal range (true blacks, clean whites), every plane crisp and in focus throughout the scene — deep focus, no shallow depth of field, no blurry background.`,
      `Composition: 35mm lens, frontal shot, camera positioned close to the wall. The framed artwork should fill roughly 65-75% of the image height and be the unmistakable visual anchor. DO NOT crop so tight that the room disappears — this must still read as a real lifestyle photo in a home, not an isolated product mockup: always keep a small recognizable hint of furniture and wall texture in frame (e.g. the arm of a sofa, the corner of a bed, the edge of a dining table). At the same time, furniture must stay a partial glimpse, not a full piece — never show an entire sofa, a full table with all its chairs, or the whole bed. No other wall art or gallery-wall arrangement visible — the featured piece is the only artwork on the wall.`,
      `Curated decor (small and supporting): at most one small object partially visible near the frame's edge — a ceramic vase or a stack of design books — not a full styled tablescape. No wide-angle pull-back showing entire rooms.`,
      `The LARGE framed print is the absolute visual anchor. It dominates the composition unmistakably — the eye goes to the artwork first — while the room around it stays clearly identifiable, just visually secondary.`,
      `Frame: thin, ${FRAME_DESCRIPTIONS[frame]}, intentionally chosen to harmonize with the room's palette and decor.`,
      ORIENTATION_CLAUSE[orientation],
      FINISH_CONSTRAINTS,
      ARTWORK_FIDELITY,
      NO_TEXT_CONSTRAINT,
      `Aspect ratio ${ASPECT_RATIO_BY_ORIENTATION[orientation]}.`,
    ].join(' ');
  }

  private buildMockupPrompt(frame: FrameType, orientation: Orientation = 'vertical'): string {
    return [
      `Clean e-commerce product mockup. LARGE framed print centered on a plain off-white or very light warm gray wall, occupying the majority of the visible composition so the artwork dominates the frame.`,
      `Frame: thin ${FRAME_DESCRIPTIONS[frame]} molding, with the printed artwork mounted flush against the inner edge of the wood. The print extends from one inner edge of the frame to the other with zero gap — wood touches print directly on all four sides.`,
      ORIENTATION_CLAUSE[orientation],
      FINISH_CONSTRAINTS,
      `Straight frontal view, perfectly centered. Soft uniform studio lighting from the front-left, very subtle shadow on the right side to give depth, no harsh shadows. Minimalist premium product photography.`,
      ARTWORK_FIDELITY,
      NO_TEXT_CONSTRAINT,
      `Aspect ratio ${ASPECT_RATIO_BY_ORIENTATION[orientation]}.`,
    ].join(' ');
  }

  /**
   * Recolore a moldura de um mockup JÁ GERADO, mantendo tudo o resto
   * idêntico (ângulo, corte, luz, profundidade, renderização da arte).
   * Usado pelo pipeline pra derivar as outras 3 cores a partir da 1ª
   * gerada, em vez de gerar cada cor do zero a partir da arte crua —
   * gerar do zero produzia fotos visivelmente diferentes entre si.
   */
  buildMockupRecolorPrompt(toFrame: FrameType, orientation: Orientation = 'vertical'): string {
    return [
      MOCKUP_RECOLOR_FIDELITY,
      `THE ONLY CHANGE ALLOWED: repaint the wood frame molding to ${FRAME_DESCRIPTIONS[toFrame]}. Same thin molding shape, same proportions, same construction — only its color/material finish changes.`,
      ORIENTATION_CLAUSE[orientation],
      FINISH_CONSTRAINTS,
      NO_TEXT_CONSTRAINT,
      `Aspect ratio ${ASPECT_RATIO_BY_ORIENTATION[orientation]}.`,
    ].join(' ');
  }

  private buildVideoPrompt(frame: FrameType, orientation: Orientation = 'vertical'): string {
    return [
      `Use the uploaded image as the scene reference.`,
      ARTWORK_FIDELITY,
      FINISH_CONSTRAINTS,
      NO_TEXT_CONSTRAINT,
      `The LARGE framed artwork is the focal point and must remain identical to the reference image throughout the entire video — same colors, composition and details in every frame. Do not alter the artwork at any point.`,
      `Opening scene: young Brazilian woman, dark hair, 25–35 years old, casual linen outfit in neutral ivory tones, natural makeup, hanging the framed artwork shown in the reference image on a wall, arms raised, satisfied expression, warm golden sunlight streaming through a side window, candid authentic lifestyle moment, real refined home feel, not a photoshoot.`,
      `Then camera slowly pulls back and pans to show the framed artwork directly from the front, large and centered on the wall as the visual anchor, artwork clearly visible and identical to the reference image, no person in frame, soft even lighting, clean editorial product shot.`,
      `Frame: thin ${FRAME_DESCRIPTIONS[frame]}, harmonized with the room's palette.`,
      ORIENTATION_CLAUSE[orientation],
      `Style: photorealistic, cinematic, refined editorial home decor, smooth camera motion, warm natural light throughout. Duration: 8 seconds. Aspect ratio: 16:9.`,
    ].join(' ');
  }

  /**
   * Variante do lifestyle em 16:9 — usada no still inicial do pipeline de
   * vídeo (Imagen gera a cena estática e o Veo só aplica movimento de câmera).
   * Garante que o still herda TODAS as regras do lifestyle (quadro grande,
   * sublimado matte, sem vidro, deep focus, editorial não-AI) em vez de cair
   * em prompt hardcoded.
   */
  buildLifestyleStill16x9(
    frame: FrameType,
    room: RoomType,
    style: StyleType,
    orientation: Orientation = 'vertical',
  ): string {
    return this.buildLifestylePrompt(frame, room, style, orientation).replace(
      `Aspect ratio ${ASPECT_RATIO_BY_ORIENTATION[orientation]}.`,
      'Aspect ratio 16:9.',
    );
  }

  /**
   * Aplica a orientação a um prompt de mockup/vídeo carregado do .md
   * (texto escrito à mão, sempre pensado pra quadro vertical). Em vez de
   * reescrever o .md, faz um patch pontual: troca o aspect ratio (só no
   * mockup — vídeo mantém 16:9 fixo, que é o enquadramento da CENA, não do
   * quadro) e acrescenta a cláusula de orientação no final.
   */
  private applyOrientationToMarkdownPrompt(
    prompt: string,
    deliveryType: 'mockup' | 'video',
    orientation: Orientation,
  ): string {
    if (orientation === 'vertical') return prompt;
    const withAspect =
      deliveryType === 'mockup'
        ? prompt.replace('Aspect ratio 3:4.', `Aspect ratio ${ASPECT_RATIO_BY_ORIENTATION.horizontal}.`)
        : prompt;
    return `${withAspect} ${ORIENTATION_CLAUSE.horizontal}`;
  }

  /**
   * Obtém o prompt para a combinação de parâmetros.
   * Lifestyle precisa de room + style. Mockup/video usam só frame.
   */
  getPrompt(
    deliveryType: 'mockup' | 'video',
    frameType: FrameType,
    orientation?: Orientation,
  ): string;
  getPrompt(
    deliveryType: 'lifestyle',
    frameType: FrameType,
    roomType: RoomType,
    styleType: StyleType,
    orientation?: Orientation,
  ): string;
  getPrompt(
    deliveryType: DeliveryType,
    frameType: FrameType,
    roomTypeOrOrientation?: RoomType | Orientation,
    styleType?: StyleType,
    orientation?: Orientation,
  ): string {
    if (deliveryType === 'lifestyle') {
      const roomType = roomTypeOrOrientation as RoomType | undefined;
      if (!roomType || !styleType) {
        throw new Error('lifestyle requires roomType and styleType');
      }
      return this.buildLifestylePrompt(frameType, roomType, styleType, orientation ?? 'vertical');
    }

    const key = `${deliveryType}-${frameType}`;
    const prompt = this.prompts.get(key);
    if (!prompt) {
      throw new Error(`Prompt not found for key: ${key}`);
    }
    const mockupOrVideoOrientation = (roomTypeOrOrientation as Orientation | undefined) ?? 'vertical';
    return this.applyOrientationToMarkdownPrompt(prompt, deliveryType, mockupOrVideoOrientation);
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
    /** Orientação do quadro (largura vs altura da arte original). Padrão: vertical. */
    orientation?: Orientation;
  }): PromptVariation[] {
    const variations: PromptVariation[] = [];
    const orientation = input.orientation ?? 'vertical';

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
          prompt: this.getPrompt(
            'lifestyle',
            input.frameType,
            input.roomType,
            input.styleType,
            orientation,
          ),
        });
      } else {
        variations.push({
          type: deliveryType,
          frameType: input.frameType,
          prompt: this.getPrompt(deliveryType, input.frameType, orientation),
        });
      }
    }

    return variations;
  }
}

export const promptAgentService = new PromptAgentService();
export { FRAMES, ROOMS, STYLES };
export type { FrameType, RoomType, StyleType, DeliveryType, PromptVariation, Orientation };
