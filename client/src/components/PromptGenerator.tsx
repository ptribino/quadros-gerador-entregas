import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import ImageSelector from './ImageSelector';

type DeliveryType = 'lifestyle' | 'mockup' | 'video';
type FrameType = 'pine' | 'aluminum';
type EnvironmentType = 'scandinavian' | 'modern';

interface PromptGeneratorProps {
  kitSize?: number;
}

export default function PromptGenerator({ kitSize = 1 }: PromptGeneratorProps) {
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('lifestyle');
  const [frameType, setFrameType] = useState<FrameType>('pine');
  const [environmentType, setEnvironmentType] = useState<EnvironmentType>('scandinavian');
  const [isKit, setIsKit] = useState(false);
  const [kitQuantity, setKitQuantity] = useState(kitSize);
  const [copied, setCopied] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ url: string; fileName: string } | undefined>();

  const frameLabel = {
    pine: 'natural pine wood',
    aluminum: 'matte black aluminum',
  };

  const environmentDescriptions = {
    scandinavian: 'Scandinavian living room, white plaster wall, light oak floating shelf below, ceramic vase with dried pampas grass, linen sofa in warm white, warm whites and sage green palette, eye-level wide shot, minimalist decor, not overly staged.',
    modern: 'Modern contemporary apartment living room, white walls, light concrete floor, low-profile modular sofa in light gray, indoor fiddle leaf fig plant, large window with soft diffused light, cool neutral palette with natural wood accents, wide angle eye-level shot, upscale residential feel, not a showroom.',
  };

  const basePrompts = {
    lifestyle: `Use the uploaded image as the artwork. Do not alter, reinterpret or stylize the artwork in any way — reproduce it exactly as provided. Place it as a framed print hanging on a wall. The frame should be thin and [MOLDURA: ${frameLabel[frameType]}]. Show the artwork clearly, with correct proportions and full visibility. Soft natural window light from the left. Lived-in authentic home feel — not a photoshoot, not a showroom. Editorial interior photography, 35mm lens, shallow depth of field, photorealistic. Aspect ratio 4:5.`,
    mockup: `Now create a clean product mockup of this exact artwork — do not alter or reinterpret the image. Place it as a framed print on a plain white or very light gray wall. Frame: thin [MOLDURA: ${frameLabel[frameType]}] with white mat border. Straight frontal view, perfectly centered. Soft uniform studio lighting, no harsh shadows, no reflections on glass. Minimalist product photography style, e-commerce background. Aspect ratio 4:5.`,
    video: `Use the uploaded image as the scene reference. The framed artwork must remain identical to the reference image throughout the entire video — same colors, composition and details in every frame. Do not alter the artwork at any point. Opening scene: young Brazilian woman, dark hair, 25–35 years old, casual linen outfit in neutral ivory tones, natural makeup, hanging the framed artwork shown in the reference image on a white wall, arms raised, satisfied expression, warm natural window light from left, candid authentic lifestyle moment, real home feel, not a photoshoot. Then camera slowly pulls back and pans to show the framed artwork directly from the front, full frame, centered on the wall, artwork clearly visible and identical to the reference image, no person in frame, soft even lighting, clean editorial product shot. Style: photorealistic, cinematic, editorial home decor, smooth camera motion, warm natural light throughout. Duration: 8 seconds. Aspect ratio: 16:9.`,
  };

  const generatedPrompt = useMemo(() => {
    let prompt = basePrompts[deliveryType];

    if (deliveryType === 'lifestyle') {
      prompt = `${environmentDescriptions[environmentType]} ` + prompt;
    }

    if (isKit && kitQuantity > 1) {
      const kitInstruction = deliveryType === 'video'
        ? `This is a set of ${kitQuantity} artworks. Display all ${kitQuantity} framed prints together as a cohesive gallery wall arrangement, each artwork reproduced exactly as uploaded, maintaining correct individual proportions and consistent spacing between frames.`
        : deliveryType === 'mockup'
        ? `Display all ${kitQuantity} framed prints side by side, frontal view, evenly spaced, each artwork identical to the uploaded references, clean white background.`
        : `This is a set of ${kitQuantity} artworks. Display all ${kitQuantity} framed prints together as a cohesive gallery wall arrangement, each artwork reproduced exactly as uploaded, maintaining correct individual proportions and consistent spacing between frames.`;
      
      prompt += ` ${kitInstruction}`;
    }

    return prompt;
  }, [deliveryType, frameType, environmentType, isKit, kitQuantity]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setCopied(true);
      toast.success('Prompt copiado para a área de transferência!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Erro ao copiar o prompt');
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-background">
      {/* Sidebar */}
      <div className="w-full md:w-80 border-b md:border-b-0 md:border-r border-border bg-white p-6 md:p-8 overflow-y-auto">
        <div className="space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Gerador de Prompts</h1>
            <p className="text-sm text-muted-foreground">Crie prompts precisos para seus ativos de e-commerce</p>
          </div>

          {/* Image Selector */}
          <div className="space-y-3 pt-4 border-t border-border">
            <ImageSelector
              onImageSelect={(url, fileName) => setSelectedImage(url ? { url, fileName } : undefined)}
              selectedImage={selectedImage}
            />
          </div>

          {/* Delivery Type */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-foreground">Tipo de Entrega</label>
            <div className="space-y-2">
              {[
                { value: 'lifestyle' as const, label: 'Ambiente Lifestyle' },
                { value: 'mockup' as const, label: 'Mockup de Produto' },
                { value: 'video' as const, label: 'Vídeo Lifestyle' },
              ].map((option) => (
                <label key={option.value} className="flex items-center space-x-3 cursor-pointer group">
                  <input
                    type="radio"
                    name="delivery"
                    value={option.value}
                    checked={deliveryType === option.value}
                    onChange={(e) => setDeliveryType(e.target.value as DeliveryType)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-sm text-foreground group-hover:text-primary transition-colors">{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Frame Type */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-foreground">Tipo de Moldura</label>
            <div className="space-y-2">
              {[
                { value: 'pine' as const, label: 'Madeira de Pinho Natural' },
                { value: 'aluminum' as const, label: 'Alumínio Preto Fosco' },
              ].map((option) => (
                <label key={option.value} className="flex items-center space-x-3 cursor-pointer group">
                  <input
                    type="radio"
                    name="frame"
                    value={option.value}
                    checked={frameType === option.value}
                    onChange={(e) => setFrameType(e.target.value as FrameType)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-sm text-foreground group-hover:text-primary transition-colors">{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Environment Type (only for lifestyle) */}
          {deliveryType === 'lifestyle' && (
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-foreground">Estilo de Ambiente</label>
              <div className="space-y-2">
                {[
                  { value: 'scandinavian' as const, label: 'Escandinavo/Clean' },
                  { value: 'modern' as const, label: 'Moderno/Contemporâneo' },
                ].map((option) => (
                  <label key={option.value} className="flex items-center space-x-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="environment"
                      value={option.value}
                      checked={environmentType === option.value}
                      onChange={(e) => setEnvironmentType(e.target.value as EnvironmentType)}
                      className="w-4 h-4 accent-primary"
                    />
                    <span className="text-sm text-foreground group-hover:text-primary transition-colors">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Kit Options */}
          <div className="space-y-3 pt-4 border-t border-border">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isKit}
                onChange={(e) => setIsKit(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm font-semibold text-foreground">É um kit de múltiplos quadros?</span>
            </label>
            
            {isKit && (
              <div className="ml-7 space-y-2">
                <label className="block text-xs font-medium text-muted-foreground">Quantidade de quadros</label>
                <input
                  type="number"
                  min="2"
                  max="10"
                  value={kitQuantity}
                  onChange={(e) => setKitQuantity(Math.max(2, parseInt(e.target.value) || 2))}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-input text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col p-6 md:p-8 overflow-hidden">
        <div className="flex-1 flex flex-col">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-foreground mb-2">Preview e Prompt</h2>
            <p className="text-sm text-muted-foreground">Visualize a imagem e copie o prompt gerado</p>
          </div>

          {/* Image Preview and Prompt Display */}
          <div className="flex-1 flex gap-6 overflow-hidden">
            {/* Image Preview */}
            {selectedImage?.url && (
              <div className="flex-1 flex flex-col">
                <div className="flex-1 bg-muted rounded-md overflow-hidden border border-border">
                  <img
                    src={selectedImage.url}
                    alt="Selected artwork"
                    className="w-full h-full object-contain"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2 text-center">{selectedImage.fileName}</p>
              </div>
            )}

            {/* Prompt Display */}
            <Card className="flex-1 p-6 bg-white border border-border flex flex-col">
              <pre className="flex-1 text-sm text-foreground font-mono overflow-auto whitespace-pre-wrap break-words">
                {generatedPrompt}
              </pre>
            </Card>
          </div>

          {/* Copy Button */}
          <div className="mt-6 flex justify-end">
            <Button
              onClick={handleCopy}
              className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2 rounded-md transition-colors duration-150"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  Copiado!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copiar Prompt
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-8 pt-6 border-t border-border">
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Dica:</strong> Sempre revise o prompt antes de usar para garantir que todas as especificações estão corretas.</p>
            <p><strong>Fidelidade:</strong> Lembre-se de manter a fidelidade absoluta à arte original em todas as gerações.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
