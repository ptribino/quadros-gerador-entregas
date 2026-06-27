import fs from 'fs';
import path from 'path';

type EnvironmentType = 'scandinavian' | 'modern' | 'corporate' | 'kitchen' | 'kids';

interface PromptVariation {
  type: 'lifestyle' | 'mockup' | 'video';
  frameType: 'pine' | 'aluminum';
  environmentType?: EnvironmentType;
  prompt: string;
}

type PromptKey = string;

class PromptAgentService {
  private prompts: Map<PromptKey, string> = new Map();

  constructor() {
    this.loadPrompts();
  }

  /**
   * Carrega os prompts pré-cadastrados do arquivo prompts_gerados.md
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

        if (title.includes('Lifestyle') && title.includes('Pinho') && title.includes('Escandinavo')) {
          this.prompts.set('lifestyle-pine-scandinavian', promptText);
        } else if (title.includes('Lifestyle') && title.includes('Alumínio') && title.includes('Escandinavo')) {
          this.prompts.set('lifestyle-aluminum-scandinavian', promptText);
        } else if (title.includes('Lifestyle') && title.includes('Pinho') && title.includes('Moderno')) {
          this.prompts.set('lifestyle-pine-modern', promptText);
        } else if (title.includes('Lifestyle') && title.includes('Alumínio') && title.includes('Moderno')) {
          this.prompts.set('lifestyle-aluminum-modern', promptText);
        } else if (title.includes('Lifestyle') && title.includes('Pinho') && title.includes('Corporativo')) {
          this.prompts.set('lifestyle-pine-corporate', promptText);
        } else if (title.includes('Lifestyle') && title.includes('Alumínio') && title.includes('Corporativo')) {
          this.prompts.set('lifestyle-aluminum-corporate', promptText);
        } else if (title.includes('Lifestyle') && title.includes('Pinho') && title.includes('Cozinha')) {
          this.prompts.set('lifestyle-pine-kitchen', promptText);
        } else if (title.includes('Lifestyle') && title.includes('Alumínio') && title.includes('Cozinha')) {
          this.prompts.set('lifestyle-aluminum-kitchen', promptText);
        } else if (title.includes('Lifestyle') && title.includes('Pinho') && title.includes('Infantil')) {
          this.prompts.set('lifestyle-pine-kids', promptText);
        } else if (title.includes('Lifestyle') && title.includes('Alumínio') && title.includes('Infantil')) {
          this.prompts.set('lifestyle-aluminum-kids', promptText);
        } else if (title.includes('Mockup') && title.includes('Pinho')) {
          this.prompts.set('mockup-pine', promptText);
        } else if (title.includes('Mockup') && title.includes('Alumínio')) {
          this.prompts.set('mockup-aluminum', promptText);
        } else if (title.includes('Vídeo') && title.includes('Pinho')) {
          this.prompts.set('video-pine', promptText);
        } else if (title.includes('Vídeo') && title.includes('Alumínio')) {
          this.prompts.set('video-aluminum', promptText);
        }
      }

      console.log(`[PromptAgent] Loaded ${this.prompts.size} pre-built prompts`);
    } catch (error) {
      console.error('[PromptAgent] Error loading prompts file, using fallback prompts:', error);
      this.loadFallbackPrompts();
    }
  }

  private loadFallbackPrompts() {
    const frameLabels = { pine: 'natural pine wood', aluminum: 'matte black aluminum' };
    const envDescriptions: Record<EnvironmentType, string> = {
      scandinavian: 'Scandinavian living room, white plaster wall, light oak floating shelf below, ceramic vase with dried pampas grass, linen sofa in warm white, warm whites and sage green palette, eye-level wide shot, minimalist decor, not overly staged.',
      modern: 'Modern contemporary apartment living room, white walls, light concrete floor, low-profile modular sofa in light gray, indoor fiddle leaf fig plant, large window with soft diffused light, cool neutral palette with natural wood accents, wide angle eye-level shot, upscale residential feel, not a showroom.',
      corporate: 'Upscale corporate office interior, executive meeting room or private office, white or light gray painted wall, sleek office desk or conference table visible in the foreground, ergonomic office chairs, subtle corporate decor — potted plant, stacked books, laptop — large window with soft natural light filtering through blinds, polished concrete or neutral carpet floor, professional and elegant atmosphere, gender-neutral environment.',
      kitchen: 'Modern Brazilian kitchen and dining area, light oak wooden dining table with four upholstered chairs in warm beige linen, ceramic tableware and a fresh fruit bowl on the table, white shaker-style cabinets with brushed brass handles in the background, light quartz or marble countertop, single black pendant light hanging above the table, white painted wall, terracotta or light wood floor, small herb pots on the windowsill, warm natural daylight from a side window, cozy lived-in family atmosphere, not staged, not a showroom.',
      kids: "Bright cheerful children's bedroom, soft pastel palette of dusty pink, mint green and warm cream, low children's bed with crisp white linens and a few plush toys, light wood floor with a small geometric play rug, a low wooden bookshelf with picture books and stuffed animals, sheer white curtains diffusing soft natural daylight, simple wooden toys arranged neatly, indoor potted plant, playful and magical but tasteful and uncluttered childhood atmosphere, real lived-in family home, not a showroom.",
    };

    for (const frame of ['pine', 'aluminum'] as const) {
      for (const env of ['scandinavian', 'modern', 'corporate', 'kitchen', 'kids'] as const) {
        this.prompts.set(
          `lifestyle-${frame}-${env}`,
          `${envDescriptions[env]} Use the uploaded image as the artwork. Do not alter, reinterpret or stylize the artwork in any way — reproduce it exactly as provided. Place it as a framed print hanging on a wall. The frame should be thin and ${frameLabels[frame]}. Show the artwork clearly, with correct proportions and full visibility. Soft natural window light from the left. Lived-in authentic home feel — not a photoshoot, not a showroom. Editorial interior photography, 35mm lens, shallow depth of field, photorealistic. Aspect ratio 4:5.`
        );
      }

      this.prompts.set(
        `mockup-${frame}`,
        `Now create a clean product mockup of this exact artwork — do not alter or reinterpret the image. Place it as a framed print on a plain white or very light gray wall. Frame: thin ${frameLabels[frame]} with white mat border. Straight frontal view, perfectly centered. Soft uniform studio lighting, no harsh shadows, no reflections on glass. Minimalist product photography style, e-commerce background. Aspect ratio 4:5.`
      );

      this.prompts.set(
        `video-${frame}`,
        `Use the uploaded image as the scene reference. The framed artwork must remain identical to the reference image throughout the entire video — same colors, composition and details in every frame. Do not alter the artwork at any point. Opening scene: young Brazilian woman, dark hair, 25–35 years old, casual linen outfit in neutral ivory tones, natural makeup, hanging the framed artwork shown in the reference image on a white wall, arms raised, satisfied expression, warm natural window light from left, candid authentic lifestyle moment, real home feel, not a photoshoot. Then camera slowly pulls back and pans to show the framed artwork directly from the front, full frame, centered on the wall, artwork clearly visible and identical to the reference image, no person in frame, soft even lighting, clean editorial product shot. Frame: thin ${frameLabels[frame]}. Style: photorealistic, cinematic, editorial home decor, smooth camera motion, warm natural light throughout. Duration: 8 seconds. Aspect ratio: 16:9.`
      );
    }
  }

  /**
   * Obtém o prompt pré-cadastrado para a combinação de parâmetros
   */
  getPrompt(
    deliveryType: 'lifestyle' | 'mockup' | 'video',
    frameType: 'pine' | 'aluminum',
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
    deliveryTypes: Array<'lifestyle' | 'mockup' | 'video'> = ['lifestyle', 'mockup', 'video']
  ): PromptVariation[] {
    const prompts: PromptVariation[] = [];

    for (const deliveryType of deliveryTypes) {
      for (const frameType of ['pine', 'aluminum'] as const) {
        if (deliveryType === 'lifestyle') {
          for (const environmentType of ['scandinavian', 'modern', 'corporate', 'kitchen', 'kids'] as const) {
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
