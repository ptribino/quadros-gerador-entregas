import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";

type StatusFilter = "all" | "suggested" | "approved" | "rejected" | "exported";

export default function CatalogPage() {
  const { user, loading: authLoading } = useAuth();
  const [categoryId, setCategoryId] = useState<string>("");
  const [folderId, setFolderId] = useState<string>("");
  const [count, setCount] = useState<number>(15);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("suggested");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const utils = trpc.useUtils();
  const categoriesQuery = trpc.catalog.listCategories.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const foldersQuery = trpc.catalog.listBankFolders.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const productsQuery = trpc.catalog.listSuggestions.useQuery(
    {
      status: statusFilter === "all" ? undefined : (statusFilter as any),
      categoryCodeId: categoryId ? Number(categoryId) : undefined,
    },
    { enabled: Boolean(user) },
  );

  const suggestMutation = trpc.catalog.suggestProducts.useMutation({
    onSuccess: (res) => {
      toast.success(
        `Análise concluída — ${res.succeeded} sugestões, ${res.skipped} já existentes, ${res.failed} falhas.`,
      );
      if (res.errors.length > 0) {
        console.error("[catalog] Falhas:", res.errors);
      }
      utils.catalog.listSuggestions.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateStatusMutation = trpc.catalog.updateProductStatus.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.updated} produtos atualizados`);
      setSelectedIds(new Set());
      utils.catalog.listSuggestions.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const downloadFromMutation = (res: { fileName: string; mimeType: string; base64: string; rows: number }) => {
    const link = document.createElement("a");
    link.href = `data:${res.mimeType};base64,${res.base64}`;
    link.download = res.fileName;
    link.click();
    toast.success(`Planilha gerada com ${res.rows} produtos`);
  };

  const exportMutation = trpc.catalog.exportSuggestions.useMutation({
    onSuccess: downloadFromMutation,
    onError: (err) => toast.error(err.message),
  });

  const exportTrayMutation = trpc.catalog.exportTrayImport.useMutation({
    onSuccess: downloadFromMutation,
    onError: (err) => toast.error(err.message),
  });

  const folderByName = useMemo(() => {
    const map = new Map<number, { id: string; name: string } | null>();
    if (!foldersQuery.data || !categoriesQuery.data) return map;
    for (const cat of categoriesQuery.data) {
      const folder = foldersQuery.data.find((f) => f.name === cat.folderName);
      map.set(cat.id, folder ? { id: folder.id, name: folder.name } : null);
    }
    return map;
  }, [foldersQuery.data, categoriesQuery.data]);

  const handleSelectCategory = (id: string) => {
    setCategoryId(id);
    const cat = categoriesQuery.data?.find((c) => c.id === Number(id));
    if (cat) {
      const folder = foldersQuery.data?.find((f) => f.name === cat.folderName);
      if (folder) setFolderId(folder.id);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!productsQuery.data) return;
    setSelectedIds(new Set(productsQuery.data.map((p) => p.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  if (authLoading) {
    return <div className="p-8 text-muted-foreground">Carregando...</div>;
  }
  if (!user) {
    return (
      <div className="p-8">
        <Button onClick={() => (window.location.href = getLoginUrl())}>
          Entrar com Google
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Curadoria de Catálogo</h1>
          <p className="text-sm text-muted-foreground">
            Passo 1: gerar sugestões a partir do banco de imagens no Drive.
          </p>
        </div>
        <Button variant="outline" onClick={() => (window.location.href = "/")}>
          ← Geração manual
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gerar sugestões por categoria</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr,1fr,120px,auto]">
          <div className="space-y-1">
            <Label>Categoria</Label>
            <Select value={categoryId} onValueChange={handleSelectCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {categoriesQuery.data?.map((cat) => {
                  const folder = folderByName.get(cat.id);
                  return (
                    <SelectItem key={cat.id} value={String(cat.id)}>
                      {cat.code3} — {cat.displayName} {folder ? "✓" : "(sem pasta)"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Folder ID (auto-preenchido)</Label>
            <Input
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              placeholder="ID da pasta no Drive"
            />
          </div>
          <div className="space-y-1">
            <Label>Quantidade</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 15)))}
            />
          </div>
          <div className="flex items-end">
            <Button
              disabled={!categoryId || !folderId || suggestMutation.isPending}
              onClick={() =>
                suggestMutation.mutate({
                  folderId,
                  categoryCodeId: Number(categoryId),
                  count,
                })
              }
            >
              {suggestMutation.isPending ? "Analisando..." : "Gerar sugestões"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Sugestões</CardTitle>
            <p className="text-xs text-muted-foreground">
              {productsQuery.data?.length ?? 0} produtos · {selectedIds.size} selecionado(s)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="suggested">Sugeridos</SelectItem>
                <SelectItem value="approved">Aprovados</SelectItem>
                <SelectItem value="rejected">Rejeitados</SelectItem>
                <SelectItem value="exported">Exportados</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={selectAll}>
              Selecionar todos
            </Button>
            <Button size="sm" variant="outline" onClick={clearSelection}>
              Limpar
            </Button>
            <Button
              size="sm"
              disabled={selectedIds.size === 0 || updateStatusMutation.isPending}
              onClick={() =>
                updateStatusMutation.mutate({
                  productIds: Array.from(selectedIds),
                  status: "approved",
                })
              }
            >
              Aprovar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={selectedIds.size === 0 || updateStatusMutation.isPending}
              onClick={() =>
                updateStatusMutation.mutate({
                  productIds: Array.from(selectedIds),
                  status: "rejected",
                })
              }
            >
              Rejeitar
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={exportMutation.isPending}
              onClick={() =>
                exportMutation.mutate(
                  selectedIds.size > 0
                    ? { productIds: Array.from(selectedIds) }
                    : { status: statusFilter === "all" ? undefined : (statusFilter as any) },
                )
              }
              title="Planilha interna com metadados da curadoria (descricaoHtml, potencial, palavras-chave)"
            >
              {exportMutation.isPending ? "..." : "Exportar curadoria"}
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={exportTrayMutation.isPending}
              onClick={() =>
                exportTrayMutation.mutate(
                  selectedIds.size > 0
                    ? { productIds: Array.from(selectedIds) }
                    : { status: statusFilter === "all" ? undefined : (statusFilter as any) },
                )
              }
              title="Planilha pronta para importar na Tray (formato 30 colunas)"
            >
              {exportTrayMutation.isPending ? "..." : "Exportar Tray"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2"></th>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Nome</th>
                <th className="px-3 py-2 text-center">Potencial</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Origem</th>
              </tr>
            </thead>
            <tbody>
              {productsQuery.data?.map((p) => (
                <tr key={p.id} className="border-b hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selectedIds.has(p.id)}
                      onCheckedChange={() => toggleSelect(p.id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-3 py-2">{p.nome}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={(p.aiPotencialVenda ?? 0) >= 7 ? "default" : "secondary"}>
                      {p.aiPotencialVenda ?? "—"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {p.sourceDriveFileUrl ? (
                      <a
                        className="text-xs text-primary underline"
                        href={p.sourceDriveFileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Drive
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {productsQuery.data && productsQuery.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhuma sugestão neste filtro. Gere sugestões acima.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "approved":
    case "exported":
      return "default";
    case "rejected":
    case "error":
      return "destructive";
    case "suggested":
      return "secondary";
    default:
      return "outline";
  }
}
