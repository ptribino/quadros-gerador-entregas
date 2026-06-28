import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import ImageSelector from '@/components/ImageSelector';
import GenerationResults from '@/components/GenerationResults';

type FrameType = 'light_wood' | 'dark_wood' | 'white' | 'black';
type EnvironmentType = 'scandinavian' | 'modern' | 'corporate' | 'kitchen' | 'kids';

interface GeneratedImage {
  id: string;
  url: string;
  type: 'lifestyle' | 'mockup' | 'video';
  frameType: FrameType;
  environmentType?: EnvironmentType;
  prompt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

export default function GenerationPage() {
  const [selectedImage, setSelectedImage] = useState<{ url: string; fileName: string } | undefined>();
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [frameType, setFrameType] = useState<FrameType>('light_wood');
  const [environmentType, setEnvironmentType] = useState<EnvironmentType>('scandinavian');

  const generateMutation = trpc.generation.generateImages.useMutation();
  const saveImageMutation = trpc.drive.saveImage.useMutation();

  const handleGenerateImages = async () => {
    if (!selectedImage?.url) {
      toast.error('Por favor, selecione uma imagem primeiro');
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateMutation.mutateAsync({
        imageUrl: selectedImage.url,
        deliveryTypes: ['lifestyle', 'mockup', 'video'],
        frameType,
        environmentType,
      });

      // Mapeia os resultados para o formato esperado
      const images: GeneratedImage[] = result.results.map((r, index) => ({
        id: `${r.generationId}-${index}`,
        url: r.images?.[0]?.url || '',
        type: r.type,
        frameType: r.frameType,
        environmentType: r.environmentType,
        prompt: r.prompt,
        status: r.status as any,
        error: r.error,
      }));

      setGeneratedImages(images);
      toast.success(`${result.totalGenerated} imagens geradas com sucesso!`);
    } catch (error) {
      toast.error('Erro ao gerar imagens');
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveToGoogleDrive = async (image: GeneratedImage) => {
    try {
      const result = await saveImageMutation.mutateAsync({
        imageUrl: image.url,
        fileName: `${image.type}-${image.frameType}.png`,
        type: image.type,
        frameType: image.frameType,
      });

      toast.success(`Imagem salva: ${result.fileName}`);
    } catch (error) {
      toast.error('Erro ao salvar no Google Drive');
      console.error(error);
      throw error;
    }
  };

  const handleDownload = (image: GeneratedImage) => {
    const link = document.createElement('a');
    link.href = image.url;
    link.download = `${image.type}-${image.frameType}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-background p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-foreground mb-2">Gerador de Imagens com IA</h1>
          <p className="text-muted-foreground">
            Carregue uma imagem e gere variações com Google Imagen e Veo
          </p>
        </div>

        {/* Configuration Section */}
        <Card className="p-6 bg-white border border-border space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Image Selector */}
            <div>
              <ImageSelector
                onImageSelect={(url, fileName) =>
                  setSelectedImage(url ? { url, fileName } : undefined)
                }
                selectedImage={selectedImage}
              />
            </div>

            {/* Options */}
            <div className="space-y-4">
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
                    <label key={option.value} className="flex items-center space-x-3 cursor-pointer">
                      <input
                        type="radio"
                        name="frame"
                        value={option.value}
                        checked={frameType === option.value}
                        onChange={(e) => setFrameType(e.target.value as FrameType)}
                        className="w-4 h-4 accent-primary"
                      />
                      <span className="text-sm text-foreground">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Environment Type */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-foreground">
                  Estilo de Ambiente (Lifestyle)
                </label>
                <div className="space-y-2">
                  {[
                    { value: 'scandinavian' as const, label: 'Escandinavo / Clean' },
                    { value: 'modern' as const, label: 'Moderno / Contemporâneo' },
                    { value: 'corporate' as const, label: 'Corporativo' },
                    { value: 'kitchen' as const, label: 'Cozinha / Área de Jantar' },
                    { value: 'kids' as const, label: 'Infantil' },
                  ].map((option) => (
                    <label key={option.value} className="flex items-center space-x-3 cursor-pointer">
                      <input
                        type="radio"
                        name="environment"
                        value={option.value}
                        checked={environmentType === option.value}
                        onChange={(e) =>
                          setEnvironmentType(e.target.value as EnvironmentType)
                        }
                        className="w-4 h-4 accent-primary"
                      />
                      <span className="text-sm text-foreground">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Generate Button */}
              <Button
                onClick={handleGenerateImages}
                disabled={!selectedImage?.url || isGenerating}
                className="w-full mt-6 bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Gerar Imagens com IA
                  </>
                )}
              </Button>
            </div>
          </div>
        </Card>

        {/* Results Section */}
        {generatedImages.length > 0 && (
          <GenerationResults
            images={generatedImages}
            isLoading={isGenerating}
            onSaveToGoogleDrive={handleSaveToGoogleDrive}
            onDownload={handleDownload}
          />
        )}
      </div>
    </div>
  );
}
