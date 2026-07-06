import React, { useMemo, useRef, useState } from "react";
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

type StatusFilter =
  | "all"
  | "suggested"
  | "approved"
  | "generating"
  | "generated"
  | "exported"
  | "rejected"
  | "error";
type GenFilter = "all" | "generated" | "in_progress" | "queued" | "failed" | "none";
type SortKey = "sku" | "nome" | "potencial" | "status" | "geracao";
type SortDir = "asc" | "desc";
type StyleOverride =
  | "auto"
  | "goquadros_signature"
  | "scandinavian"
  | "japandi"
  | "minimalist"
  | "boho"
  | "classic"
  | "contemporary"
  | "mid_century_br"
  | "brazilian_modern";

const STYLE_OVERRIDE_OPTIONS: ReadonlyArray<{ value: StyleOverride; label: string }> = [
  { value: "auto", label: "Automático — padrão GoQuadros" },
  { value: "goquadros_signature", label: "Padrão GoQuadros" },
  { value: "scandinavian", label: "Escandinavo" },
  { value: "japandi", label: "Japandi" },
  { value: "minimalist", label: "Minimalista" },
  { value: "boho", label: "Boho" },
  { value: "classic", label: "Clássico" },
  { value: "contemporary", label: "Contemporâneo" },
  { value: "mid_century_br", label: "Mid-Century Brasileiro" },
  { value: "brazilian_modern", label: "Brasil Moderno" },
];

// Sentinel pro Select de subpasta — Radix não aceita value="" em SelectItem
// (reservado internamente pra "sem seleção").
const SUBFOLDER_ALL = "__all__";

const STATUS_ORDER: readonly Exclude<StatusFilter, "all">[] = [
  "suggested",
  "approved",
  "generating",
  "generated",
  "exported",
  "rejected",
  "error",
];
const STATUS_LABELS: Record<Exclude<StatusFilter, "all">, string> = {
  suggested: "Sugeridos",
  approved: "Aprovados",
  generating: "Gerando",
  generated: "Gerados",
  exported: "Cadastrado na Tray",
  rejected: "Rejeitados",
  error: "Com erro",
};

const GEN_RANK: Record<GenFilter, number> = {
  // usado pra ordenar a coluna "Geração" (mais avançado → mais "pronto")
  all: 0,
  none: 0,
  queued: 1,
  in_progress: 2,
  failed: 3,
  generated: 4,
};

export default function CatalogPage() {
  const { user, loading: authLoading } = useAuth();
  const [categoryId, setCategoryId] = useState<string>("");
  const [folderId, setFolderId] = useState<string>("");
  const [subFolderId, setSubFolderId] = useState<string>(SUBFOLDER_ALL);
  const [folderLinkInput, setFolderLinkInput] = useState<string>("");
  const [folderLinkError, setFolderLinkError] = useState<string>("");
  const [count, setCount] = useState<number>(15);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("suggested");
  const [genFilter, setGenFilter] = useState<GenFilter>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [styleOverride, setStyleOverride] = useState<StyleOverride>("auto");

  const utils = trpc.useUtils();
  const categoriesQuery = trpc.catalog.listCategories.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const foldersQuery = trpc.catalog.listBankFolders.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const categoryRootFolderId = useMemo(() => {
    if (!categoryId || !foldersQuery.data || !categoriesQuery.data) return undefined;
    const cat = categoriesQuery.data.find((c) => c.id === Number(categoryId));
    return cat && foldersQuery.data.find((f) => f.name === cat.folderName)?.id;
  }, [categoryId, foldersQuery.data, categoriesQuery.data]);
  const subFoldersQuery = trpc.catalog.listBankFolders.useQuery(
    { parentFolderId: categoryRootFolderId },
    { enabled: Boolean(user) && Boolean(categoryRootFolderId) },
  );
  // Sem filtro de status no servidor: busca todos os status da categoria
  // selecionada de uma vez, pra dar pra mostrar a contagem por status E
  // filtrar localmente sem precisar refazer a query a cada troca de filtro.
  const productsQuery = trpc.catalog.listSuggestions.useQuery(
    {
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
      // NÃO limpa a seleção: o usuário tipicamente quer aprovar e em seguida
      // gerar imagens dos mesmos itens. Preservar selectedIds evita ter que
      // re-marcar todos os checkboxes.
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

  const trayVariationsInputRef = useRef<HTMLInputElement>(null);
  const exportTrayVariationsMutation =
    trpc.catalog.exportTrayVariations.useMutation({
      onSuccess: (res) => {
        downloadFromMutation({
          fileName: res.fileName,
          mimeType: res.mimeType,
          base64: res.base64,
          rows: res.rows,
        });
        toast.success(
          `${res.products} produto(s) → ${res.rows} variações geradas (32 por produto).`,
          { duration: 6000 },
        );
        if (res.skipped.length > 0) {
          const preview = res.skipped.slice(0, 3).join(", ");
          const suffix =
            res.skipped.length > 3 ? `, +${res.skipped.length - 3}` : "";
          toast.warning(
            `${res.skipped.length} SKU(s) sem 'Código do produto (ID)' na planilha: ${preview}${suffix}`,
            { duration: 8000 },
          );
        }
        if (res.skusSemMockupPorMoldura.length > 0) {
          const preview = res.skusSemMockupPorMoldura.slice(0, 3).join(", ");
          const suffix =
            res.skusSemMockupPorMoldura.length > 3
              ? `, +${res.skusSemMockupPorMoldura.length - 3}`
              : "";
          toast.warning(
            `${res.skusSemMockupPorMoldura.length} produto(s) sem mockup por moldura (gerados antes dessa mudança) — variações sem imagem: ${preview}${suffix}`,
            { duration: 8000 },
          );
        }
      },
      onError: (err) => toast.error(err.message),
    });

  const handleVariationsFilePick = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      exportTrayVariationsMutation.mutate({ fileBase64: dataUrl });
    };
    reader.onerror = () => toast.error("Erro ao ler o arquivo");
    reader.readAsDataURL(file);
  };

  const exportTrayMutation = trpc.catalog.exportTrayImport.useMutation({
    onSuccess: (res) => {
      const skipped = res.skipped ?? [];

      // Se NENHUM produto tem imagem, não baixa planilha vazia — só avisa.
      if (res.rows === 0) {
        toast.error(
          `Nenhum dos ${skipped.length} produtos selecionados tem imagens geradas. Rode "Gerar imagens" antes de exportar.`,
          { duration: 8000 },
        );
        return;
      }

      downloadFromMutation(res);

      if (skipped.length > 0) {
        const preview = skipped.slice(0, 3).map((s) => s.sku).join(", ");
        const suffix = skipped.length > 3 ? `, +${skipped.length - 3}` : "";
        toast.warning(
          `${skipped.length} produto(s) ignorado(s) por não ter imagens geradas: ${preview}${suffix}`,
          { duration: 8000 },
        );
      }
      const semMockup = res.skusSemMockupPorMoldura ?? [];
      if (semMockup.length > 0) {
        const preview = semMockup.slice(0, 3).join(", ");
        const suffix = semMockup.length > 3 ? `, +${semMockup.length - 3}` : "";
        toast.warning(
          `${semMockup.length} produto(s) sem mockup por moldura (gerados antes dessa mudança) — faltam fotos 3-6 da galeria: ${preview}${suffix}`,
          { duration: 8000 },
        );
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // Status global da fila + polling enquanto há trabalho em andamento.
  const generationStatusQuery = trpc.catalog.generationStatus.useQuery(undefined, {
    enabled: Boolean(user),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && (data.queued > 0 || data.running > 0) ? 4000 : false;
    },
  });

  const enqueueMutation = trpc.catalog.enqueueGeneration.useMutation({
    onSuccess: (res) => {
      const minutes = Math.ceil(res.queued * 1.5);
      toast.success(
        `${res.queued} produtos na fila — ~${minutes} min total. Acompanhe na coluna GERAÇÃO.`,
        { duration: 6000 },
      );
      utils.catalog.listSuggestions.invalidate();
      utils.catalog.generationStatus.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // Mantém a tabela atualizada enquanto o worker processa.
  const isWorking =
    (generationStatusQuery.data?.queued ?? 0) +
      (generationStatusQuery.data?.running ?? 0) >
    0;
  trpc.catalog.listSuggestions.useQuery(
    {
      categoryCodeId: categoryId ? Number(categoryId) : undefined,
    },
    {
      enabled: Boolean(user) && isWorking,
      refetchInterval: isWorking ? 5000 : false,
    },
  );

  // Contagem por status sobre TODOS os produtos da categoria (antes do
  // filtro de status escolhido) — dá pra ver o volume de cada etapa do
  // funil sem precisar trocar o filtro toda hora.
  const statusCounts = useMemo(() => {
    const counts = {} as Record<string, number>;
    for (const p of productsQuery.data ?? []) {
      counts[p.status] = (counts[p.status] ?? 0) + 1;
    }
    return counts;
  }, [productsQuery.data]);

  const visibleProducts = useMemo(() => {
    const list = productsQuery.data ?? [];
    const byStatus =
      statusFilter === "all" ? list : list.filter((p) => p.status === statusFilter);
    const term = searchTerm.trim().toLowerCase();
    const bySearch = term
      ? byStatus.filter((p) => {
          const haystack = [
            p.sku,
            p.nome,
            p.marca,
            p.modelo,
            p.aiPalavrasChave,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(term);
        })
      : byStatus;
    const filtered = genFilter === "all"
      ? bySearch
      : bySearch.filter((p) => classifyGen(p) === genFilter);
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: number | string, b: number | string) =>
      a < b ? -1 * dir : a > b ? 1 * dir : 0;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "sku":
          return cmp(a.sku ?? "", b.sku ?? "");
        case "nome":
          return cmp((a.nome ?? "").toLowerCase(), (b.nome ?? "").toLowerCase());
        case "potencial":
          return cmp(a.aiPotencialVenda ?? -1, b.aiPotencialVenda ?? -1);
        case "status":
          return cmp(a.status ?? "", b.status ?? "");
        case "geracao":
          return cmp(GEN_RANK[classifyGen(a)], GEN_RANK[classifyGen(b)]);
      }
    });
  }, [productsQuery.data, statusFilter, genFilter, searchTerm, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

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
    const folder = cat && foldersQuery.data?.find((f) => f.name === cat.folderName);
    // Preenche com a pasta mapeada quando existe; caso contrário limpa o campo
    // pra deixar claro que o usuário precisa colar o folderId manualmente
    // (categorias marcadas "(sem pasta)").
    setFolderId(folder ? folder.id : "");
    // Nova categoria = reseta a escolha de subpasta da categoria anterior.
    setSubFolderId(SUBFOLDER_ALL);
  };

  const handleSelectSubFolder = (id: string) => {
    setSubFolderId(id);
    // SUBFOLDER_ALL = "Todas as subpastas" -> volta a apontar pra pasta-mãe
    // da categoria (suggestProducts já mergulha recursivamente nas subpastas).
    setFolderId(id === SUBFOLDER_ALL ? categoryRootFolderId ?? "" : id);
  };

  // Pra pastas que ainda não estão mapeadas a nenhuma categoria (ex: banco
  // de imagens de terceiros) — mesma lógica do ImageSelector na geração manual.
  const handleFolderLinkChange = (value: string) => {
    setFolderLinkInput(value);
    setFolderLinkError("");
    if (!value.trim()) return;
    const match = value.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (match) {
      setFolderId(match[1]);
      setSubFolderId(SUBFOLDER_ALL);
    } else {
      setFolderLinkError("Link inválido. Cole o link completo de uma pasta do Google Drive.");
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
    if (!visibleProducts.length) return;
    setSelectedIds(new Set(visibleProducts.map((p) => p.id)));
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
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_110px_auto]">
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
            <Label>Subpasta (opcional)</Label>
            <Select
              value={subFolderId}
              onValueChange={handleSelectSubFolder}
              disabled={!categoryRootFolderId}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !categoryId
                      ? "Selecione uma categoria primeiro"
                      : subFoldersQuery.isLoading
                        ? "Carregando..."
                        : "Todas as subpastas"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SUBFOLDER_ALL}>Todas as subpastas</SelectItem>
                {subFoldersQuery.data?.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Folder ID (auto-preenchido)</Label>
            <Input
              value={folderId}
              onChange={(e) => {
                setFolderId(e.target.value);
                // Edição manual do ID invalida a escolha de subpasta (deixa de bater com o valor).
                setSubFolderId(SUBFOLDER_ALL);
              }}
              placeholder="ID da pasta no Drive"
            />
            <Input
              value={folderLinkInput}
              onChange={(e) => handleFolderLinkChange(e.target.value)}
              placeholder="Ou cole o link de uma pasta do Google Drive"
              className={`text-xs ${folderLinkError ? "border-destructive focus-visible:ring-destructive" : ""}`}
              title="Pra pastas que ainda não estão mapeadas a nenhuma categoria — cola o link e o ID é extraído automaticamente"
            />
            {folderLinkError && (
              <p className="text-xs text-destructive">{folderLinkError}</p>
            )}
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
        <CardHeader className="space-y-3 pb-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="text-base">Sugestões</CardTitle>
            <p className="text-xs text-muted-foreground">
              {visibleProducts.length} produtos
              {productsQuery.data && visibleProducts.length !== productsQuery.data.length && (
                <> de {productsQuery.data.length}</>
              )}{" "}
              · {selectedIds.size} selecionado(s)
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_ORDER.filter((s) => statusCounts[s]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                  className={`rounded-full px-2 py-0.5 text-[11px] ring-1 transition-colors ${
                    statusFilter === s
                      ? "bg-foreground text-background ring-foreground"
                      : "bg-muted/50 text-muted-foreground ring-border hover:bg-muted"
                  }`}
                  title={`Filtrar por ${STATUS_LABELS[s]}`}
                >
                  {STATUS_LABELS[s]}: {statusCounts[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* Seleção */}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={selectAll}>
                Selecionar todos
              </Button>
              <Button size="sm" variant="outline" onClick={clearSelection}>
                Limpar
              </Button>
            </div>

            <div className="h-6 w-px bg-border" />

            {/* Aprovação/rejeição da curadoria */}
            <div className="flex items-center gap-2">
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
            </div>

            <div className="h-6 w-px bg-border" />

            {/* Geração de imagens */}
            <div className="flex items-center gap-2">
              <Select value={styleOverride} onValueChange={(v) => setStyleOverride(v as StyleOverride)}>
                <SelectTrigger className="w-56" title="Estilo de ambiente usado nas imagens lifestyle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STYLE_OVERRIDE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={selectedIds.size === 0 || enqueueMutation.isPending}
                onClick={() =>
                  enqueueMutation.mutate({
                    productIds: Array.from(selectedIds),
                    styleOverride: styleOverride === "auto" ? undefined : styleOverride,
                  })
                }
                title="Enfileira os selecionados para gerar 3 imagens cada (lifestyle + profissional + mockup)"
              >
                {enqueueMutation.isPending ? "..." : "Gerar imagens"}
              </Button>
            </div>
          </div>

          {/* Exportação — fluxo Tray */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Exportação:</span>
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
            <input
              ref={trayVariationsInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                handleVariationsFilePick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={exportTrayVariationsMutation.isPending}
              onClick={() => trayVariationsInputRef.current?.click()}
              title="Suba a planilha de produtos que a Tray exporta após a importação (CSV ou XLSX, com a coluna 'Código produto' preenchida). Gera 32 variações por produto: 4 molduras × 8 tamanhos."
            >
              {exportTrayVariationsMutation.isPending ? "..." : "Gerar variações"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-600 text-emerald-700 hover:bg-emerald-50"
              disabled={selectedIds.size === 0 || updateStatusMutation.isPending}
              onClick={() =>
                updateStatusMutation.mutate({
                  productIds: Array.from(selectedIds),
                  status: "exported",
                })
              }
              title="Marca os selecionados como já importados na Tray com as variações cadastradas na loja"
            >
              {updateStatusMutation.isPending ? "..." : "Marcar como cadastrado"}
            </Button>
          </div>

          <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900 ring-1 ring-blue-100">
            <span className="font-medium">Como funciona:</span>{" "}
            (1) marque os produtos com <kbd className="rounded bg-white px-1 py-0.5 ring-1 ring-blue-200">checkbox</kbd>,{" "}
            (2) clique <strong>Aprovar</strong>,{" "}
            (3) com os mesmos produtos ainda marcados, clique <strong>Gerar imagens</strong> — o sistema gera 3 imagens por produto (~1.5 min cada) e salva na sua pasta do Drive.{" "}
            (4) Quando a coluna GERAÇÃO mostrar <strong className="text-emerald-600">✅ pronto</strong>, clique <strong>Exportar Tray</strong> e importe na sua loja.{" "}
            (5) Depois da importação, exporte do painel da Tray o CSV de produtos (já com os IDs) e use <strong>Gerar variações</strong> — devolve um XLS com 32 variações por produto (4 molduras × 8 tamanhos) pronto pra importar.{" "}
            Quando as variações já estiverem na loja, clique <strong>Marcar como cadastrado</strong>.
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por SKU, nome, marca..."
              className="w-56"
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="suggested">Sugeridos</SelectItem>
                <SelectItem value="approved">Aprovados</SelectItem>
                <SelectItem value="generating">Gerando</SelectItem>
                <SelectItem value="generated">Gerados</SelectItem>
                <SelectItem value="exported">Cadastrado na Tray</SelectItem>
                <SelectItem value="rejected">Rejeitados</SelectItem>
                <SelectItem value="error">Com erro</SelectItem>
              </SelectContent>
            </Select>
            <Select value={genFilter} onValueChange={(v) => setGenFilter(v as GenFilter)}>
              <SelectTrigger className="w-44" title="Filtrar por status de geração de imagens">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Geração: todos</SelectItem>
                <SelectItem value="generated">✅ pronto</SelectItem>
                <SelectItem value="in_progress">⚙️ gerando</SelectItem>
                <SelectItem value="queued">⏳ na fila</SelectItem>
                <SelectItem value="failed">❌ falha</SelectItem>
                <SelectItem value="none">Não gerado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {generationStatusQuery.data && (generationStatusQuery.data.queued + generationStatusQuery.data.running) > 0 && (
            (() => {
              const s = generationStatusQuery.data;
              const total = s.queued + s.running + s.done + s.errored;
              const pct = total > 0 ? Math.round(((s.done + s.errored) / total) * 100) : 0;
              const remaining = s.queued + s.running;
              const minutesLeft = Math.max(1, Math.ceil(remaining * 1.5));
              return (
                <div className="border-b bg-blue-50 px-4 py-2 text-xs">
                  <div className="flex items-center justify-between text-blue-900">
                    <span>
                      🎨 <span className="font-medium">Geração em andamento:</span>{" "}
                      {s.done}/{total} prontos ({pct}%) · ~{minutesLeft} min restantes
                    </span>
                    {s.errored > 0 && (
                      <span className="text-destructive">{s.errored} com erro</span>
                    )}
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })()
          )}
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2"></th>
                <SortableTh label="SKU" sortKey="sku" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Nome" sortKey="nome" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Potencial" sortKey="potencial" current={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
                <SortableTh label="Status" sortKey="status" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Geração" sortKey="geracao" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <th className="px-3 py-2 text-left">Origem</th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((p) => (
                <tr key={p.id} className="border-b hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selectedIds.has(p.id)}
                      onCheckedChange={() => toggleSelect(p.id)}
                      className="size-5 border-2 border-foreground/40 data-[state=checked]:border-primary"
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
                  <td className="px-3 py-2 text-xs">
                    {generationCellLabel(p)}
                  </td>
                  <td className="px-3 py-2">
                    {p.productDriveFolderUrl ? (
                      <a
                        className="text-xs text-primary underline"
                        href={p.productDriveFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Pasta
                      </a>
                    ) : p.sourceDriveFileUrl ? (
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
              {productsQuery.data && visibleProducts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
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

type GenInfo = {
  status: string;
  imageUrl1: string | null;
  imageUrl2: string | null;
  imageUrl3: string | null;
  genStartedAt?: Date | string | null;
  genCompletedAt?: Date | string | null;
  genStep?: number | null;
  genError?: string | null;
  genQueuedAt?: Date | string | null;
};

function classifyGen(p: GenInfo): Exclude<GenFilter, "all"> {
  if (p.imageUrl1 && p.imageUrl2 && p.imageUrl3) return "generated";
  if (p.genError && p.genCompletedAt) return "failed";
  if (p.genStartedAt && !p.genCompletedAt) return "in_progress";
  if (p.genQueuedAt) return "queued";
  return "none";
}

function SortableTh({
  label,
  sortKey,
  current,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey | null;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "center";
}) {
  const active = current === sortKey;
  const arrow = active ? (dir === "asc" ? "▲" : "▼") : "";
  return (
    <th className={`px-3 py-2 ${align === "center" ? "text-center" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
        <span className="text-[10px]">{arrow || "↕"}</span>
      </button>
    </th>
  );
}

function generationCellLabel(p: GenInfo): React.ReactNode {
  if (p.genError && p.genCompletedAt) {
    return <span className="text-destructive" title={p.genError}>❌ falha</span>;
  }
  if (p.imageUrl1 && p.imageUrl2 && p.imageUrl3) return <span className="font-medium text-emerald-600">✅ pronto</span>;
  if (p.genStartedAt && !p.genCompletedAt) {
    return <span className="text-blue-600">⚙️ gerando {p.genStep ?? 0}/3</span>;
  }
  if (p.genQueuedAt) return <span className="text-amber-600">⏳ na fila</span>;
  return <span className="text-muted-foreground text-xs">não gerado</span>;
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
