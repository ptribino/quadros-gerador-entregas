import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Save, Loader2, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface GeneratedItem {
  id: string;
  url: string;
  type: 'lifestyle' | 'mockup' | 'video';
  frameType: 'light_wood' | 'dark_wood' | 'white' | 'black';
  environmentType?: 'scandinavian' | 'modern' | 'corporate' | 'kitchen' | 'kids';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

interface GenerationResultsProps {
  images: GeneratedItem[];
  isLoading?: boolean;
  onSaveToGoogleDrive?: (item: GeneratedItem) => Promise<void>;
  onDownload?: (item: GeneratedItem) => void;
  onReset?: () => void;
}

const typeLabels: Record<string, string> = {
  lifestyle: 'Ambiente Lifestyle',
  mockup: 'Mockup de Produto',
  video: 'Vídeo Lifestyle',
};

const frameLabels: Record<string, string> = {
  light_wood: 'Amadeirado Claro',
  dark_wood: 'Amadeirado Escuro',
  white: 'Branca',
  black: 'Preta',
};

const envLabels: Record<string, string> = {
  scandinavian: 'Escandinavo',
  modern: 'Moderno',
  corporate: 'Corporativo',
  kitchen: 'Cozinha / Área de Jantar',
  kids: 'Infantil',
};

export default function GenerationResults({
  images,
  isLoading = false,
  onSaveToGoogleDrive,
  onDownload,
  onReset,
}: GenerationResultsProps) {
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const handleSave = async (item: GeneratedItem) => {
    if (!onSaveToGoogleDrive) return;

    setSavingIds((prev) => new Set(prev).add(item.id));
    try {
      await onSaveToGoogleDrive(item);
      // Só chega aqui se a Promise resolveu — ou seja, salvamento confirmado com sucesso
      setSavedIds((prev) => new Set(prev).add(item.id));
    } catch (error) {
      // Cancelamento pelo usuário (fechar dialog sem confirmar) não exibe erro
      const isCancelled = error instanceof Error && error.message === 'cancelled';
      if (!isCancelled) {
        toast.error('Erro ao salvar no Google Drive');
        console.error(error);
      }
      // savedIds NÃO é atualizado — botão permanece habilitado para nova tentativa
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleDownload = (item: GeneratedItem) => {
    if (!onDownload) return;
    try {
      onDownload(item);
      toast.success('Download iniciado!');
    } catch (error) {
      toast.error('Erro ao fazer download');
    }
  };

  if (isLoading) {
    return (
      <Card className="p-8 bg-white border border-border">
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
          <div className="text-center">
            <p className="text-base font-medium text-foreground">Gerando sua entrega...</p>
            <p className="text-sm text-muted-foreground mt-1">
              Usando Google Imagen / Veo com fidelidade total à arte original
            </p>
            <p className="text-xs text-muted-foreground mt-2">Isso pode levar alguns minutos</p>
          </div>
        </div>
      </Card>
    );
  }

  if (images.length === 0) return null;

  return (
    <Card className="p-6 bg-white border border-border space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          <h3 className="text-lg font-semibold text-foreground">Entregas Geradas</h3>
        </div>
        {onReset && (
          <Button
            onClick={onReset}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Nova geração
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {images.map((item) => (
          <div key={item.id} className="border border-border rounded-lg overflow-hidden">
            {/* Preview */}
            <div className="relative w-full aspect-[4/5] bg-muted overflow-hidden">
              {item.status === 'completed' && item.url ? (
                item.type === 'video' ? (
                  <video
                    src={item.url}
                    controls
                    className="w-full h-full object-contain bg-black"
                    poster=""
                  />
                ) : (
                  <img
                    src={item.url}
                    alt={typeLabels[item.type]}
                    className="w-full h-full object-contain"
                  />
                )
              ) : item.status === 'failed' ? (
                <div className="w-full h-full flex items-center justify-center bg-destructive/5">
                  <div className="text-center p-4">
                    <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
                    <p className="text-sm font-medium text-destructive">Falha na geração</p>
                    {item.error && (
                      <p className="text-xs text-destructive/80 mt-2 max-w-xs">{item.error}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              )}

              {/* Type Badge */}
              <div className="absolute top-3 left-3 bg-black/60 text-white text-xs font-medium px-3 py-1 rounded-full">
                {typeLabels[item.type]}
              </div>
            </div>

            {/* Info + Actions */}
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="bg-muted px-2 py-1 rounded text-muted-foreground">
                  {frameLabels[item.frameType]}
                </span>
                {item.environmentType && (
                  <span className="bg-muted px-2 py-1 rounded text-muted-foreground">
                    {envLabels[item.environmentType]}
                  </span>
                )}
              </div>

              {item.status === 'completed' && item.url && (
                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={() => handleDownload(item)}
                    variant="outline"
                    size="sm"
                    className="flex-1 flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Baixar
                  </Button>
                  <Button
                    onClick={() => handleSave(item)}
                    disabled={savingIds.has(item.id) || savedIds.has(item.id)}
                    size="sm"
                    className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90"
                  >
                    {savingIds.has(item.id) ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Salvando...
                      </>
                    ) : savedIds.has(item.id) ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Salvo!
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Google Drive
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
