import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Upload, X, Loader2, HardDrive, Image as ImageIcon, FolderOpen, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';

interface ImageSelectorProps {
  onImageSelect: (imageUrl: string, fileName: string) => void;
  selectedImage?: { url: string; fileName: string };
}

type DriveStep = 'folders' | 'images';

export default function ImageSelector({ onImageSelect, selectedImage }: ImageSelectorProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isDriveOpen, setIsDriveOpen] = useState(false);
  const [driveStep, setDriveStep] = useState<DriveStep>('folders');
  const [selectedFolder, setSelectedFolder] = useState<{ id: string | null; name: string }>({ id: null, name: 'Meu Drive' });
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const foldersQuery = trpc.drive.listFolders.useQuery(undefined, {
    enabled: isDriveOpen && driveStep === 'folders',
  });

  const imagesQuery = trpc.drive.listImages.useQuery(
    { folderId: selectedFolder.id ?? undefined },
    { enabled: isDriveOpen && driveStep === 'images' }
  );

  const utils = trpc.useUtils();

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Por favor, selecione uma imagem válida');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 10MB');
      return;
    }

    setIsLoading(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageUrl = e.target?.result as string;
      onImageSelect(imageUrl, file.name);
      toast.success('Imagem carregada com sucesso!');
      setIsLoading(false);
    };
    reader.onerror = () => {
      toast.error('Erro ao carregar a imagem');
      setIsLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleOpenDrive = () => {
    setDriveStep('folders');
    setSelectedFolder({ id: null, name: 'Meu Drive' });
    setFolderImages([]);
    setIsDriveOpen(true);
  };

  const handleSelectFolder = (folderId: string | null, folderName: string) => {
    setSelectedFolder({ id: folderId, name: folderName });
    setDriveStep('images');
  };

  const handleDriveFileSelect = async (fileId: string, fileName: string, mimeType: string) => {
    setLoadingFileId(fileId);
    try {
      const result = await utils.drive.getFileContent.fetch({ fileId, mimeType });
      onImageSelect(result.dataUrl, fileName);
      toast.success('Imagem carregada do Google Drive!');
      setIsDriveOpen(false);
    } catch {
      toast.error('Erro ao carregar imagem do Drive');
    } finally {
      setLoadingFileId(null);
    }
  };

  const handleRemoveImage = () => {
    onImageSelect('', '');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCloseDrive = (open: boolean) => {
    setIsDriveOpen(open);
    if (!open) {
      setDriveStep('folders');
      setSelectedFolder({ id: null, name: 'Meu Drive' });
      setFolderImages([]);
    }
  };

  const displayImages = imagesQuery.data?.files ?? [];
  const isImagesLoading = imagesQuery.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Selecionar Imagem</h3>
        {selectedImage?.fileName && (
          <span className="text-xs text-muted-foreground">{selectedImage.fileName}</span>
        )}
      </div>

      {!selectedImage?.url ? (
        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload de Imagem
              </>
            )}
          </Button>

          <Button
            onClick={handleOpenDrive}
            variant="outline"
            className="w-full flex items-center justify-center gap-2"
          >
            <HardDrive className="w-4 h-4" />
            Selecionar do Google Drive
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Formatos suportados: JPG, PNG, GIF, WebP (máx. 10MB)
          </p>
        </div>
      ) : (
        <Card className="p-4 space-y-3 bg-white border border-border">
          <div className="relative w-full bg-muted rounded-md overflow-hidden flex items-center justify-center" style={{ minHeight: '120px' }}>
            <img
              src={selectedImage.url}
              alt="Selected"
              className="w-full h-auto max-h-[500px] object-contain"
            />
          </div>

          <Button
            onClick={handleRemoveImage}
            variant="outline"
            className="w-full flex items-center justify-center gap-2 border-border text-destructive hover:bg-destructive/10"
          >
            <X className="w-4 h-4" />
            Remover Imagem
          </Button>
        </Card>
      )}

      {/* Dialog do Google Drive — dois passos */}
      <Dialog open={isDriveOpen} onOpenChange={handleCloseDrive}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {driveStep === 'images' && (
                <button
                  onClick={() => setDriveStep('folders')}
                  className="p-1 rounded hover:bg-muted transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              <HardDrive className="w-5 h-5" />
              {driveStep === 'folders'
                ? 'Escolher pasta no Google Drive'
                : `Imagens em "${selectedFolder.name}"`}
            </DialogTitle>
          </DialogHeader>

          {/* Passo 1: Seleção de Pasta */}
          {driveStep === 'folders' && (
            <div className="flex-1 overflow-y-auto space-y-2 mt-2">
              {foldersQuery.isLoading && (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Carregando pastas...
                </div>
              )}

              {foldersQuery.isError && (
                <div className="text-center py-8 text-destructive text-sm">
                  Erro ao carregar pastas. Verifique sua conexão.
                </div>
              )}

              {/* Opção: Raiz do Drive */}
              {!foldersQuery.isLoading && (
                <button
                  onClick={() => handleSelectFolder(null, 'Meu Drive')}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted transition-colors text-left"
                >
                  <HardDrive className="w-5 h-5 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Meu Drive</p>
                    <p className="text-xs text-muted-foreground">Todas as imagens</p>
                  </div>
                </button>
              )}

              {foldersQuery.data?.folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => handleSelectFolder(folder.id, folder.name)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted transition-colors text-left"
                >
                  <FolderOpen className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                  <span className="text-sm truncate">{folder.name}</span>
                </button>
              ))}

              {foldersQuery.data?.folders.length === 0 && !foldersQuery.isLoading && (
                <p className="text-xs text-muted-foreground text-center py-2">Nenhuma subpasta encontrada.</p>
              )}
            </div>
          )}

          {/* Passo 2: Seleção de Imagem */}
          {driveStep === 'images' && (
            <div className="flex-1 overflow-y-auto space-y-2 mt-2">
              {isImagesLoading && (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Carregando imagens...
                </div>
              )}

              {!isImagesLoading && displayImages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                  <ImageIcon className="w-8 h-8" />
                  <p className="text-sm">Nenhuma imagem encontrada nesta pasta.</p>
                </div>
              )}

              {displayImages.map((file) => (
                <button
                  key={file.id}
                  onClick={() => handleDriveFileSelect(file.id, file.name, file.mimeType)}
                  disabled={loadingFileId === file.id}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted transition-colors text-left disabled:opacity-60"
                >
                  {loadingFileId === file.id ? (
                    <Loader2 className="w-5 h-5 animate-spin text-primary flex-shrink-0" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  )}
                  <span className="text-sm truncate">{file.name}</span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
