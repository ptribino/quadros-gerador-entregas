import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ImageSelectorProps {
  onImageSelect: (imageUrl: string, fileName: string) => void;
  selectedImage?: { url: string; fileName: string };
}

export default function ImageSelector({ onImageSelect, selectedImage }: ImageSelectorProps) {
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Por favor, selecione uma imagem válida');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 10MB');
      return;
    }

    setIsLoading(true);

    // Create a local URL for the image
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

  const handleGoogleDriveClick = () => {
    toast.info('Integração com Google Drive em desenvolvimento');
    // TODO: Implement Google Drive integration
  };

  const handleRemoveImage = () => {
    onImageSelect('', '');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

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
          {/* Upload Button */}
          <div>
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
          </div>

          {/* Help Text */}
          <p className="text-xs text-muted-foreground text-center">
            Formatos suportados: JPG, PNG, GIF, WebP (máx. 10MB)
          </p>
        </div>
      ) : (
        <Card className="p-4 space-y-3 bg-white border border-border">
          {/* Image Preview */}
          <div className="relative w-full bg-muted rounded-md overflow-hidden flex items-center justify-center" style={{ minHeight: '120px' }}>
            <img
              src={selectedImage.url}
              alt="Selected"
              className="w-full h-auto max-h-[500px] object-contain"
            />
          </div>

          {/* Remove Button */}
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
    </div>
  );
}
