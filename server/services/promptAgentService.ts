import fs from 'fs';
import path from 'path';

type EnvironmentType = 'scandinavian' | 'modern' | 'corporate' | 'kitchen' | 'kids';
type FrameType = 'light_wood' | 'dark_wood' | 'white' | 'black';
type DeliveryType = 'lifestyle' | 'mockup' | 'video';

interface PromptVariation {
  type: DeliveryType;
  frameType: FrameType;
  environmentType?: EnvironmentType;
  prompt: string;
}

const FRAMES: readonly FrameType[] = ['light_wood', 'dark_wood', 'white', 'black'];
const ENVIRONMENTS: readonly EnvironmentType[] = ['scandinavian', 'modern', 'corporate', 'kitchen', 'kids'];

// Match dos rótulos em PT do prompts_gerados.md → slug interno.
const FRAME_LABEL_TO_SLUG: ReadonlyArray<readonly [string, FrameType]> = [
  ['Amadeirado Claro', 'light_wood'],
  ['Amadeirado Escuro', 'dark_wood'],
  ['Branca', 'white'],
  ['Preta', 'black'],
];

const ENV_LABEL_TO_SLUG: ReadonlyArray<readonly [string, EnvironmentType]> = [
  ['Escandinavo', 'scandinavian'],
  ['Moderno', 'modern'],
  ['Corporativo', 'corporate'],
  ['Cozinha', 'kitchen'],
  ['Infantil', 'kids'],
];

const FRAME_DESCRIPTIONS: Record<FrameType, string> = {
  light_wood: 'natural light oak wood',
  dark_wood: 'dark walnut wood with a rich espresso brown finish',
  white: 'painted matte white with a clean smooth finish',
  black: 'painted matte black with a clean smooth finish',
};

const ENV_DESCRIPTIONS: Record<EnvironmentType, string> = {
  scandinavian:
    'Scandinavian living room, white plaster wall, light oak floating shelf below, ceramic vase with dried pampas grass, linen sofa in warm white, warm whites and sage green palette, eye-level wide shot, minimalist decor, not overly staged.',
  modern:
    'Modern contemporary apartment living room, white walls, light concrete floor, low-profile modular sofa in light gray, indoor fiddle leaf fig plant, large window with soft diffused light, cool neutral palette with natural wood accents, wide angle eye-level shot, upscale residential feel, not a showroom.',
  corporate:
    'Upscale corporate office interior, executive meeting room or private office, white or light gray painted wall, sleek office desk or conference table visible in the foreground, ergonomic office chairs, subtle corporate decor — potted plant, stacked books, laptop — large window with soft natural light filtering through blinds, polished concrete or neutral carpet floor, professional and elegant atmosphere, gender-neutral environment.',
  kitchen:
    'Modern Brazilian kitchen and dining area, light oak wooden dining table with four upholstered chairs in warm beige linen, ceramic tableware and a fresh fruit bowl on the table, white shaker-style cabinets with brushed brass handles in the background, light quartz or marble countertop, single black pendant light hanging above the table, white painted wall, terracotta or light wood floor, small herb pots on the windowsill, warm natural daylight from a side window, cozy lived-in family atmosphere, not staged, not a showroom.',
  kids:
    "Bright cheerful children's bedroom, soft pastel palette of dusty pink, mint green and warm cream, low children's bed with crisp white linens and a few plush toys, light wood floor with a small geometric play rug, a low wooden bookshelf with picture books and stuffed animals, sheer white curtains diffusing soft natural daylight, simple wooden toys arranged neatly, indoor potted plant, playful and magical but tasteful and uncluttered childhood atmosphere, real lived-in family home, not a showroom.",
};

type PromptKey = string;

class PromptAgentService {
  private prompts: Map<PromptKey, string> = new Map();

  constructor() {
    this.loadPrompts();
  }

  /**
   * Carrega os prompts pré-cadastrados do arquivo prompts_gerados.md.
   * Para qualquer combinação que não esteja no .md, gera o prompt programaticamente
   * a partir de FRAME_DESCRIPTIONS + ENV_DESCRIPTIONS.
   */
  private loadPrompts() {
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

      console.log(`[PromptAgent] Loaded ${this.prompts.size} pre-built prompts from .md`);
    } catch (error) {
      console.error('[PromptAgent] Error loading prompts file, using fallback prompts:', error);
    }

    // Garante cobertura completa: gera fallback pra qualquer combinação ausente.
    this.fillMissingWithFallback();
    console.log(`[PromptAgent] Total prompts available: ${this.prompts.size}`);
  }

  /**
   * Converte um título do .md (ex: "Lifestyle - Amadeirado Claro - Escandinavo")
   * na chave interna (ex: "lifestyle-light_wood-scandinavian"). Retorna null se
   * não bater com nenhum padrão conhecido.
   */
  private parseTitle(title: string): string | null {
    const frameMatch = FRAME_LABEL_TO_SLUG.find(([label]) => title.includes(label));
    if (!frameMatch) return null;
    const [, frameSlug] = frameMatch;

    if (title.startsWith('Lifestyle')) {
      const envMatch = ENV_LABEL_TO_SLUG.find(([label]) => title.includes(label));
      if (!envMatch) return null;
      const [, envSlug] = envMatch;
      return `lifestyle-${frameSlug}-${envSlug}`;
    }
    if (title.startsWith('Mockup')) {
      return `mockup-${frameSlug}`;
    }
    if (title.startsWith('Vídeo')) {
      return `video-${frameSlug}`;
    }
    return null;
  }

  private fillMissingWithFallback() {
    for (const frame of FRAMES) {
      for (const env of ENVIRONMENTS) {
        const key = `lifestyle-${frame}-${env}`;
        if (!this.prompts.has(key)) {
          this.prompts.set(key, this.buildLifestylePrompt(frame, env));
        }
      }
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

  private buildLifestylePrompt(frame: FrameType, env: EnvironmentType): string {
    return `${ENV_DESCRIPTIONS[env]} Use the uploaded image as the artwork. Do not alter, reinterpret or stylize the artwork in any way — reproduce it exactly as provided. Place it as a framed print hanging on a wall. The frame should be thin and ${FRAME_DESCRIPTIONS[frame]}. Show the artwork clearly, with correct proportions and full visibility. Soft natural window light from the left. Lived-in authentic home feel — not a photoshoot, not a showroom. Editorial interior photography, 35mm lens, shallow depth of field, photorealistic. Aspect ratio 4:5.`;
  }

  private buildMockupPrompt(frame: FrameType): string {
    return `Now create a clean product mockup of this exact artwork — do not alter or reinterpret the image. Place it as a framed print on a plain white or very light gray wall. Frame: thin ${FRAME_DESCRIPTIONS[frame]} with white mat border. Straight frontal view, perfectly centered. Soft uniform studio lighting, no harsh shadows, no reflections on glass. Minimalist product photography style, e-commerce background. Aspect ratio 4:5.`;
  }

  private buildVideoPrompt(frame: FrameType): string {
    return `Use the uploaded image as the scene reference. The framed artwork must remain identical to the reference image throughout the entire video — same colors, composition and details in every frame. Do not alter the artwork at any point. Opening scene: young Brazilian woman, dark hair, 25–35 years old, casual linen outfit in neutral ivory tones, natural makeup, hanging the framed artwork shown in the reference image on a white wall, arms raised, satisfied expression, warm natural window light from left, candid authentic lifestyle moment, real home feel, not a photoshoot. Then camera slowly pulls back and pans to show the framed artwork directly from the front, full frame, centered on the wall, artwork clearly visible and identical to the reference image, no person in frame, soft even lighting, clean editorial product shot. Frame: thin ${FRAME_DESCRIPTIONS[frame]}. Style: photorealistic, cinematic, editorial home decor, smooth camera motion, warm natural light throughout. Duration: 8 seconds. Aspect ratio: 16:9.`;
  }

  /**
   * Obtém o prompt pré-cadastrado para a combinação de parâmetros
   */
  getPrompt(
    deliveryType: DeliveryType,
    frameType: FrameType,
    environmentType?: EnvironmentType
  ): string {
    let key: string;

    if (deliveryType === 'lifestyle') {
      key = `lifestyle-${frameType}-${environmentType || 'scandinavian'}`;
    } else {
      key = `${deliveryType}-${frameType}`;
    }

    const prompt = this.prompts.get(key);
    if (!prompt) {
      throw new Error(`Prompt not found for key: ${key}`);
    }

    return prompt;
  }

  /**
   * Gera as variações de prompts usando os prompts pré-cadastrados
   */
  generatePromptVariations(
    deliveryTypes: Array<DeliveryType> = ['lifestyle', 'mockup', 'video']
  ): PromptVariation[] {
    const prompts: PromptVariation[] = [];

    for (const deliveryType of deliveryTypes) {
      for (const frameType of FRAMES) {
        if (deliveryType === 'lifestyle') {
          for (const environmentType of ENVIRONMENTS) {
            prompts.push({
              type: deliveryType,
              frameType,
              environmentType,
              prompt: this.getPrompt(deliveryType, frameType, environmentType),
            });
          }
        } else {
          prompts.push({
            type: deliveryType,
            frameType,
            prompt: this.getPrompt(deliveryType, frameType),
          });
        }
      }
    }

    return prompts;
  }
}

export const promptAgentService = new PromptAgentService();
