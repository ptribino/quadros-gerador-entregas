import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import ImageSelector from './ImageSelector';

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

const ROOM_OPTIONS: ReadonlyArray<{ value: RoomType; label: string }> = [
  { value: 'living_room', label: 'Sala' },
  { value: 'bedroom', label: 'Quarto' },
  { value: 'kids_room', label: 'Quarto Infantil' },
  { value: 'office', label: 'Escritório' },
  { value: 'kitchen', label: 'Cozinha / Área de Jantar' },
  { value: 'bathroom', label: 'Lavabo' },
  { value: 'gourmet_area', label: 'Área Gourmet' },
];

const STYLE_OPTIONS: ReadonlyArray<{ value: StyleType; label: string }> = [
  { value: 'goquadros_signature', label: 'Padrão GoQuadros (recomendado)' },
  { value: 'scandinavian', label: 'Escandinavo' },
  { value: 'japandi', label: 'Japandi' },
  { value: 'minimalist', label: 'Minimalista' },
  { value: 'boho', label: 'Boho' },
  { value: 'classic', label: 'Clássico' },
  { value: 'contemporary', label: 'Contemporâneo' },
  { value: 'mid_century_br', label: 'Mid-Century Brasileiro' },
  { value: 'brazilian_modern', label: 'Brasil Moderno' },
];

interface PromptGeneratorProps {
  kitSize?: number;
}

export default function PromptGenerator({ kitSize = 1 }: PromptGeneratorProps) {
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('lifestyle');
  const [frameType, setFrameType] = useState<FrameType>('light_wood');
  const [roomType, setRoomType] = useState<RoomType>('living_room');
  const [styleType, setStyleType] = useState<StyleType>('goquadros_signature');
  const [isKit, setIsKit] = useState(false);
  const [kitQuantity, setKitQuantity] = useState(kitSize);
  const [copied, setCopied] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ url: string; fileName: string } | undefined>();

  const frameLabel: Record<FrameType, string> = {
    light_wood: 'natural light oak wood',
    dark_wood: 'dark walnut wood with a rich espresso brown finish',
    white: 'painted matte white with a clean smooth finish',
    black: 'painted matte black with a clean smooth finish',
  };

  const roomDescriptions: Record<RoomType, string> = {
    living_room:
      'a residential living room with a comfortable sofa, a coffee table, an area rug, a side lamp, and a large window providing natural daylight',
    bedroom:
      'a primary bedroom with a queen bed dressed in crisp linens, two bedside tables with reading lamps, a small bench at the foot of the bed, and sheer curtains diffusing soft daylight',
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

  const styleDescriptions: Record<StyleType, string> = {
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

  const artworkFidelity =
    'CRITICAL — ABSOLUTE FIDELITY TO THE UPLOADED ARTWORK: The uploaded image is the artwork that will be placed inside the frame. You MUST reproduce it EXACTLY as provided — identical composition, identical colors, identical lines, identical details, identical proportions. Do NOT alter, reinterpret, stylize, recolor, recrop, simplify, redraw or change the artwork in ANY way. The artwork inside the frame must look pixel-faithful to the reference image.';

  const finishConstraints =
    'MATERIAL: Print is on matte sublimation paper (no canvas, no glossy varnish). NO GLASS: the frame has NO glass overlay, NO acrylic, NO clear cover of any kind. NO REFLECTIONS: no specular highlights, no glare, no shiny surface on the artwork. NO MAT BORDER: no white passe-partout, no inner mat — the artwork fills the frame edge to edge.';

  const generatedPrompt = useMemo(() => {
    let prompt: string;

    if (deliveryType === 'lifestyle') {
      prompt = [
        `${styleDescriptions[styleType]} applied to ${roomDescriptions[roomType]}.`,
        `Indistinguishable from a professional editorial interior shoot for a premium decor brand (reference: goquadros.com.br). MUST NOT look AI-generated, MUST NOT look 3D-rendered or CG. Photographic realism with crisp focus and natural film-like quality.`,
        `Lighting: warm golden directional sunlight entering through a window, casting crisp soft shadows on the floor and adjacent surfaces. Avoid flat ambient lighting and avoid window overexposure — keep the highlights controlled.`,
        `Color and depth: vivid saturated natural colors with rich contrast, deep tonal range (true blacks, clean whites), every plane crisp and in focus throughout the scene — deep focus, no shallow depth of field, no blurry background.`,
        `Composition: 35mm lens, frontal shot, camera positioned close to the wall. The framed artwork should fill roughly 55-70% of the image height and be the unmistakable visual anchor. DO NOT crop so tight that the room disappears — this must still read as a real lifestyle photo in a home, not an isolated product mockup: always keep a small recognizable hint of furniture and wall texture in frame (e.g. the arm of a sofa, the corner of a bed, the edge of a dining table). At the same time, furniture must stay a partial glimpse, not a full piece — never show an entire sofa, a full table with all its chairs, or the whole bed. No other wall art or gallery-wall arrangement visible — the featured piece is the only artwork on the wall.`,
        `Curated decor (small and supporting): at most one small object partially visible near the frame's edge — a ceramic vase or a stack of design books — not a full styled tablescape. No wide-angle pull-back showing entire rooms.`,
        `The LARGE framed print is the absolute visual anchor. It dominates the composition unmistakably — the eye goes to the artwork first — while the room around it stays clearly identifiable, just visually secondary.`,
        `Frame: thin, ${frameLabel[frameType]}, intentionally chosen to harmonize with the room's palette and decor.`,
        finishConstraints,
        artworkFidelity,
        `Aspect ratio 4:5.`,
      ].join(' ');
    } else if (deliveryType === 'mockup') {
      prompt = [
        `Clean e-commerce product mockup. LARGE framed print centered on a plain off-white or very light warm gray wall, occupying the majority of the visible composition so the artwork dominates the frame.`,
        `Frame: thin ${frameLabel[frameType]}. The artwork goes ALL THE WAY to the frame edge — no white mat, no passe-partout, no border between artwork and frame.`,
        finishConstraints,
        `Straight frontal view, perfectly centered. Soft uniform studio lighting from the front-left, very subtle shadow on the right side to give depth, no harsh shadows. Minimalist premium product photography.`,
        artworkFidelity,
        `Aspect ratio 4:5.`,
      ].join(' ');
    } else {
      prompt = [
        `Use the uploaded image as the scene reference.`,
        artworkFidelity,
        finishConstraints,
        `The LARGE framed artwork is the focal point and must remain identical to the reference image throughout the entire video. Opening scene: young Brazilian woman, dark hair, 25–35 years old, casual linen outfit in neutral ivory tones, hanging the framed artwork on a wall, warm golden sunlight streaming through a side window, candid authentic lifestyle moment, real refined home feel. Then camera slowly pulls back to show the framed artwork directly from the front, large and centered on the wall as the visual anchor, no person in frame, soft even lighting, clean editorial product shot.`,
        `Frame: thin ${frameLabel[frameType]}, harmonized with the room's palette. Style: photorealistic, cinematic, refined editorial home decor, smooth camera motion. Duration: 8 seconds. Aspect ratio: 16:9.`,
      ].join(' ');
    }

    if (isKit && kitQuantity > 1) {
      const kitInstruction =
        deliveryType === 'mockup'
          ? `Display all ${kitQuantity} framed prints side by side, frontal view, evenly spaced, each artwork identical to the uploaded references, clean white background.`
          : `This is a set of ${kitQuantity} artworks. Display all ${kitQuantity} framed prints together as a cohesive gallery wall arrangement, each artwork reproduced exactly as uploaded, maintaining correct individual proportions and consistent spacing between frames.`;
      prompt += ` ${kitInstruction}`;
    }

    return prompt;
  }, [deliveryType, frameType, roomType, styleType, isKit, kitQuantity]);

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
                { value: 'light_wood' as const, label: 'Amadeirado Claro' },
                { value: 'dark_wood' as const, label: 'Amadeirado Escuro' },
                { value: 'white' as const, label: 'Branca' },
                { value: 'black' as const, label: 'Preta' },
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

          {/* Ambiente (cômodo) + Estilo de Decoração — só para lifestyle */}
          {deliveryType === 'lifestyle' && (
            <>
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-foreground">Ambiente (cômodo)</label>
                <select
                  value={roomType}
                  onChange={(e) => setRoomType(e.target.value as RoomType)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {ROOM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-foreground">Estilo de Decoração</label>
                <select
                  value={styleType}
                  onChange={(e) => setStyleType(e.target.value as StyleType)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
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
