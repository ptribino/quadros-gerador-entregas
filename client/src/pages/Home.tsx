import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Zap, LogIn, LogOut, Image as ImageIcon, Film, Layout, FolderOpen, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/_core/hooks/useAuth';
import { getLoginUrl } from '@/const';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import ImageSelector from '@/components/ImageSelector';
import GenerationResults from '@/components/GenerationResults';

type DeliveryType = 'lifestyle' | 'mockup' | 'video';
type FrameType = 'pine' | 'aluminum';
type EnvironmentType = 'scandinavian' | 'modern' | 'corporate';

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
  const [folderDialog, setFolderDialog] = useState<{ open: boolean; item: GeneratedItem | null }>({ open: false, item: null });
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [folderLinkInput, setFolderLinkInput] = useState('');
  const [folderLinkError, setFolderLinkError] = useState('');
  const saveCallbackRef = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  const generateMutation = trpc.generation.generateImages.useMutation();
  const saveImageMutation = trpc.drive.saveImage.useMutation();
  const foldersQuery = trpc.drive.listFolders.useQuery(undefined, { enabled: folderDialog.open });

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

  // Extrai o ID de uma pasta a partir de um link do Google Drive
  const extractFolderIdFromLink = (link: string): string | null => {
    const match = link.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  };

  const handleFolderLinkChange = (value: string) => {
    setFolderLinkInput(value);
    setFolderLinkError('');
    if (!value.trim()) return;

    const folderId = extractFolderIdFromLink(value);
    if (folderId) {
      setSelectedFolderId(folderId);
      setFolderLinkError('');
    } else {
      setFolderLinkError('Link inválido. Cole o link completo de uma pasta do Google Drive.');
      // Não desmarca a seleção anterior enquanto o link é inválido
    }
  };

  // Retorna uma Promise que só resolve após o usuário confirmar e a API responder com sucesso.
  // Se o usuário fechar o dialog sem confirmar, a Promise é rejeitada silenciosamente
  // para que GenerationResults não marque o item como salvo.
  const handleSaveToGoogleDrive = (item: GeneratedItem): Promise<void> => {
    return new Promise((resolve, reject) => {
      setSelectedFolderId(undefined);
      setFolderLinkInput('');
      setFolderLinkError('');
      saveCallbackRef.current = { resolve, reject };
      setFolderDialog({ open: true, item });
    });
  };

  const handleConfirmSave = async () => {
    const item = folderDialog.item;
    if (!item) return;

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
        folderId: selectedFolderId,
      });

      toast.success(`Salvo no Google Drive: ${result.fileName}`);
      setFolderDialog({ open: false, item: null });
      // Resolve a Promise — GenerationResults.handleSave marcará como salvo
      saveCallbackRef.current?.resolve();
      saveCallbackRef.current = null;
    } catch (error: any) {
      const msg = error?.message || '';
      if (msg.includes('login') || msg.includes('UNAUTHORIZED')) {
        toast.error('Sessão expirada. Faça login novamente.');
        window.location.href = getLoginUrl();
      } else {
        toast.error('Erro ao salvar no Google Drive');
      }
      console.error(error);
      // Rejeita a Promise — GenerationResults.handleSave não marcará como salvo
      saveCallbackRef.current?.reject(error);
      saveCallbackRef.current = null;
    }
  };

  // Chamado quando o dialog fecha sem confirmação (X ou clique fora)
  const handleFolderDialogOpenChange = (open: boolean) => {
    if (!open && saveCallbackRef.current) {
      // Rejeita silenciosamente com erro marcado como "cancelamento"
      const cancelError = new Error('cancelled');
      saveCallbackRef.current.reject(cancelError);
      saveCallbackRef.current = null;
    }
    if (!open) {
      setFolderLinkInput('');
      setFolderLinkError('');
    }
    setFolderDialog({ open, item: open ? folderDialog.item : null });
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

  // Gate de login: se não autenticado, mostra tela de login
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Quadros — Gerador de Entregas</h1>
          <p className="text-muted-foreground">Gere imagens e vídeos para e-commerce de quadros decorativos</p>
        </div>
        <Button
          onClick={() => { window.location.href = getLoginUrl(); }}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg rounded-xl"
        >
          <LogIn className="w-5 h-5" />
          Entrar com Google
        </Button>
      </div>
    );
  }

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
                    { value: 'corporate' as const, label: 'Corporativo' },
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
            onReset={() => {
              setGeneratedItems([]);
              setSelectedImage(undefined);
            }}
          />
        )}

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-4 border-t border-border">
          <p>A fidelidade absoluta à arte original é mantida em todas as gerações.</p>
        </div>
      </div>

      {/* Dialog: Escolher pasta do Drive */}
      <Dialog open={folderDialog.open} onOpenChange={handleFolderDialogOpenChange}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5" />
              Escolher pasta no Google Drive
            </DialogTitle>
          </DialogHeader>

          {/* Campo para colar link da pasta */}
          <div className="mt-3 space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <LinkIcon className="w-3 h-3" />
              Ou cole o link de uma pasta do Google Drive
            </label>
            <Input
              placeholder="https://drive.google.com/drive/folders/..."
              value={folderLinkInput}
              onChange={(e) => handleFolderLinkChange(e.target.value)}
              className={folderLinkError ? 'border-destructive focus-visible:ring-destructive' : ''}
            />
            {folderLinkError && (
              <p className="text-xs text-destructive">{folderLinkError}</p>
            )}
            {folderLinkInput && !folderLinkError && (
              <p className="text-xs text-green-600">✓ Pasta identificada pelo link</p>
            )}
          </div>

          <div className="border-t border-border my-3" />

          <div className="flex-1 overflow-y-auto space-y-2">
            {foldersQuery.isLoading && (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                Carregando pastas...
              </div>
            )}

            {/* Opção: Raiz do Drive */}
            <button
              onClick={() => { setSelectedFolderId(undefined); setFolderLinkInput(''); setFolderLinkError(''); }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                selectedFolderId === undefined && !folderLinkInput ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
              }`}
            >
              <FolderOpen className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-medium">Meu Drive (raiz)</span>
            </button>

            {foldersQuery.data?.folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => { setSelectedFolderId(folder.id); setFolderLinkInput(''); setFolderLinkError(''); }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                  selectedFolderId === folder.id && !folderLinkInput ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                }`}
              >
                <FolderOpen className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <span className="text-sm truncate">{folder.name}</span>
              </button>
            ))}

            {foldersQuery.data?.folders.length === 0 && !foldersQuery.isLoading && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma pasta encontrada.</p>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => handleFolderDialogOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmSave}
              disabled={saveImageMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saveImageMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Salvando...
                </>
              ) : (
                'Salvar aqui'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
