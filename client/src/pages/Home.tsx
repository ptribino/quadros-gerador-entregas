import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, Zap, LogIn, LogOut, Image as ImageIcon, Film, Layout } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/_core/hooks/useAuth';
import { getLoginUrl } from '@/const';
import { trpc } from '@/lib/trpc';
import ImageSelector from '@/components/ImageSelector';
import GenerationResults from '@/components/GenerationResults';

type DeliveryType = 'lifestyle' | 'mockup' | 'video';
type FrameType = 'pine' | 'aluminum';
type EnvironmentType = 'scandinavian' | 'modern';

interface GeneratedItem {
  id: string;
  url: string;
  type: DeliveryType;
  frameType: FrameType;
  environmentType?: EnvironmentType;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

export default function Home() {
  const { user, isAuthenticated, logout } = useAuth();

  const [selectedImage, setSelectedImage] = useState<{ url: string; fileName: string } | undefined>();
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('lifestyle');
  const [frameType, setFrameType] = useState<FrameType>('pine');
  const [environmentType, setEnvironmentType] = useState<EnvironmentType>('scandinavian');
  const [generatedItems, setGeneratedItems] = useState<GeneratedItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateMutation = trpc.generation.generateImages.useMutation();
  const saveImageMutation = trpc.drive.saveImage.useMutation();

  const handleGenerate = async () => {
    if (!selectedImage?.url) {
      toast.error('Selecione uma imagem da arte primeiro');
      return;
    }

    setIsGenerating(true);
    setGeneratedItems([]);

    try {
      const result = await generateMutation.mutateAsync({
        imageUrl: selectedImage.url,
        deliveryTypes: [deliveryType],
        frameType,
        environmentType: deliveryType === 'lifestyle' ? environmentType : undefined,
      });

      const items: GeneratedItem[] = result.results.map((r, index) => ({
        id: `${r.generationId}-${index}`,
        url: r.images?.[0]?.url || '',
        type: r.type,
        frameType: r.frameType,
        environmentType: r.environmentType,
        status: (r.status as any) || 'completed',
        error: r.error,
      }));

      setGeneratedItems(items);

      const successCount = items.filter((i) => i.status === 'completed' && i.url).length;
      if (successCount > 0) {
        toast.success(`${successCount} entrega(s) gerada(s) com sucesso!`);
      } else {
        toast.error('Nenhuma entrega foi gerada. Verifique os erros.');
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro ao gerar. Verifique sua conexão e API key.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveToGoogleDrive = async (item: GeneratedItem) => {
    if (!isAuthenticated) {
      toast.error('Faça login com Google para salvar no Drive');
      window.location.href = getLoginUrl();
      return;
    }

    try {
      const typeLabel = item.type === 'lifestyle' ? 'lifestyle' : item.type === 'mockup' ? 'mockup' : 'video';
      const frameLabel = item.frameType === 'pine' ? 'pinho' : 'aluminio';
      const ext = item.type === 'video' ? 'mp4' : 'png';
      const fileName = `${typeLabel}-${frameLabel}-${Date.now()}.${ext}`;

      const result = await saveImageMutation.mutateAsync({
        imageUrl: item.url,
        fileName,
        type: item.type,
        frameType: item.frameType,
      });

      toast.success(`Salvo no Google Drive: ${result.fileName}`);
    } catch (error: any) {
      const msg = error?.message || '';
      if (msg.includes('login') || msg.includes('UNAUTHORIZED')) {
        toast.error('Sessão expirada. Faça login novamente.');
        window.location.href = getLoginUrl();
      } else {
        toast.error('Erro ao salvar no Google Drive');
      }
      console.error(error);
      throw error;
    }
  };

  const handleDownload = (item: GeneratedItem) => {
    const typeLabel = item.type === 'lifestyle' ? 'lifestyle' : item.type === 'mockup' ? 'mockup' : 'video';
    const frameLabel = item.frameType === 'pine' ? 'pinho' : 'aluminio';
    const ext = item.type === 'video' ? 'mp4' : 'png';

    const link = document.createElement('a');
    link.href = item.url;
    link.download = `${typeLabel}-${frameLabel}-${Date.now()}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const deliveryOptions = [
    { value: 'lifestyle' as const, label: 'Ambiente Lifestyle', icon: ImageIcon, desc: 'Quadro em ambiente decorado' },
    { value: 'mockup' as const, label: 'Mockup de Produto', icon: Layout, desc: 'Foto de produto para e-commerce' },
    { value: 'video' as const, label: 'Vídeo Lifestyle', icon: Film, desc: 'Vídeo com pessoa pendurando o quadro' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-white p-4 md:p-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Quadros — Gerador de Entregas</h1>
            <p className="text-sm text-muted-foreground">Gere imagens e vídeos para e-commerce de quadros decorativos</p>
          </div>
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <span className="text-sm text-muted-foreground hidden md:inline">
                  {user?.name || user?.email}
                </span>
                <Button
                  onClick={() => logout()}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-1"
                >
                  <LogOut className="w-4 h-4" />
                  Sair
                </Button>
              </>
            ) : (
              <Button
                onClick={() => { window.location.href = getLoginUrl(); }}
                className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <LogIn className="w-4 h-4" />
                Entrar com Google
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-8">

        {/* Step 1: Upload da Arte */}
        <Card className="p-6 bg-white border border-border">
          <div className="flex items-center gap-3 mb-4">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold">1</span>
            <h2 className="text-lg font-semibold text-foreground">Carregue a arte original</h2>
          </div>
          <div className="max-w-sm">
            <ImageSelector
              onImageSelect={(url, fileName) =>
                setSelectedImage(url ? { url, fileName } : undefined)
              }
              selectedImage={selectedImage}
            />
          </div>
        </Card>

        {/* Step 2: Tipo de Entrega */}
        <Card className="p-6 bg-white border border-border">
          <div className="flex items-center gap-3 mb-4">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold">2</span>
            <h2 className="text-lg font-semibold text-foreground">Selecione o tipo de entrega</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {deliveryOptions.map((option) => {
              const Icon = option.icon;
              const isSelected = deliveryType === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => setDeliveryType(option.value)}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  <Icon className={`w-6 h-6 mb-2 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                  <p className={`text-sm font-semibold ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                    {option.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{option.desc}</p>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Step 3: Opções */}
        <Card className="p-6 bg-white border border-border">
          <div className="flex items-center gap-3 mb-4">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold">3</span>
            <h2 className="text-lg font-semibold text-foreground">Configure as opções</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Tipo de Moldura */}
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
                    <span className="text-sm text-foreground group-hover:text-primary transition-colors">
                      {option.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Estilo de Ambiente (só para Lifestyle) */}
            {deliveryType === 'lifestyle' && (
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-foreground">Estilo de Ambiente</label>
                <div className="space-y-2">
                  {[
                    { value: 'scandinavian' as const, label: 'Escandinavo / Clean' },
                    { value: 'modern' as const, label: 'Moderno / Contemporâneo' },
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
                      <span className="text-sm text-foreground group-hover:text-primary transition-colors">
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Generate Button */}
        <div className="flex justify-center">
          <Button
            onClick={handleGenerate}
            disabled={!selectedImage?.url || isGenerating}
            className="px-12 py-6 text-lg bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-3 rounded-xl"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {deliveryType === 'video' ? 'Gerando vídeo (pode levar até 2 min)...' : 'Gerando entrega...'}
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" />
                Gerar {deliveryType === 'lifestyle' ? 'Ambiente' : deliveryType === 'mockup' ? 'Mockup' : 'Vídeo'}
              </>
            )}
          </Button>
        </div>

        {/* Results */}
        {(generatedItems.length > 0 || isGenerating) && (
          <GenerationResults
            images={generatedItems}
            isLoading={isGenerating}
            onSaveToGoogleDrive={handleSaveToGoogleDrive}
            onDownload={handleDownload}
          />
        )}

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-4 border-t border-border">
          <p>A fidelidade absoluta à arte original é mantida em todas as gerações.</p>
        </div>
      </div>
    </div>
  );
}
