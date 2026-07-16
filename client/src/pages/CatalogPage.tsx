import React, { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";
import { FONT_SANS, FONT_MONO, FIELD_LABEL_CLASS, FIELD_INPUT_CLASS, GHOST_BTN_CLASS } from "@/lib/designTokens";

/** Miniatura autenticada de um arquivo do banco do Drive (ver server/_core/driveThumbProxy.ts). */
function DriveThumb({ fileId, name }: { fileId: string; name: string }) {
  return (
    <img
      src={`/api/drive-thumb/${fileId}`}
      alt={name}
      title={name}
      loading="lazy"
      className="h-full w-full object-cover"
    />
  );
}

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
type OrientationMode = "ambos" | "somente_retrato" | "somente_paisagem";

const ORIENTATION_MODE_OPTIONS: ReadonlyArray<{ value: OrientationMode; label: string }> = [
  { value: "ambos", label: "Ambos (padrão)" },
  { value: "somente_retrato", label: "Somente retrato" },
  { value: "somente_paisagem", label: "Somente paisagem" },
];
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

const PAGE_SIZE = 25;

const GEN_RANK: Record<GenFilter, number> = {
  // usado pra ordenar a coluna "Geração" (mais avançado → mais "pronto")
  all: 0,
  none: 0,
  queued: 1,
  in_progress: 2,
  failed: 3,
  generated: 4,
};

/** Paleta rotativa pra miniatura quando o produto não tem imagem de origem (sourceDriveFileId). */
const THUMB_FALLBACK_COLORS = ["#F3E8D8", "#E4E9F7", "#E9E4F7", "#DDEFE7", "#F7E4E4"];

type StatusKey = Exclude<StatusFilter, "all">;
const STATUS_STYLE: Record<StatusKey, { dot: string; badgeBg: string; badgeText: string }> = {
  suggested: { dot: "#A8A29E", badgeBg: "#F1F0EE", badgeText: "#57534E" },
  approved: { dot: "#22C55E", badgeBg: "#DCFCE7", badgeText: "#15803D" },
  generating: { dot: "#3B82F6", badgeBg: "#DBEAFE", badgeText: "#1D4ED8" },
  generated: { dot: "#6366F1", badgeBg: "#EEF2FF", badgeText: "#4338CA" },
  exported: { dot: "#A8A29E", badgeBg: "#F1F0EE", badgeText: "#57534E" },
  rejected: { dot: "#EF4444", badgeBg: "#FEE2E2", badgeText: "#B91C1C" },
  error: { dot: "#F59E0B", badgeBg: "#FEF3C7", badgeText: "#B45309" },
};

const INSTRUCTION_STEPS: React.ReactNode[] = [
  <>Marque os produtos com a caixa de seleção.</>,
  <>
    Clique em <strong>Aprovar</strong>.
  </>,
  <>
    Com os mesmos produtos ainda marcados, clique em <strong>Gerar imagens</strong> — o sistema
    gera 3 imagens por produto (~1,5 min cada) e salva na sua pasta do Drive.
  </>,
  <>
    Quando a coluna <strong>Geração</strong> mostrar{" "}
    <strong className="text-emerald-600">✅ pronto</strong>, clique em{" "}
    <strong>Exportar Tray</strong> e importe na sua loja.
  </>,
  <>
    Depois da importação, exporte do painel da Tray o CSV de produtos (já com os IDs) e use{" "}
    <strong>Gerar variações</strong> — devolve um XLS com as variações por produto (Tamanho ×
    Orientação) pronto pra importar; ajuste <strong>Orientação</strong> pra "Somente
    retrato"/"Somente paisagem" se a arte não puder ser reenquadrada na outra orientação. Quando
    as variações já estiverem na loja, clique <strong>Marcar como cadastrado</strong>.
  </>,
];

export default function CatalogPage() {
  const { user, loading: authLoading } = useAuth();
  const [categoryId, setCategoryId] = useState<string>("");
  const [folderId, setFolderId] = useState<string>("");
  // Pasta "raiz" cujas subpastas aparecem no seletor Subpasta abaixo — igual
  // a `folderId` na maioria dos casos, mas fica parada no pai quando o
  // usuário escolhe uma subpasta específica (senão o seletor perderia as
  // opções irmãs). Atualizada ao trocar Categoria, colar link, ou tirar o
  // foco do campo Folder ID editado manualmente.
  const [baseFolderId, setBaseFolderId] = useState<string>("");
  const [subFolderId, setSubFolderId] = useState<string>(SUBFOLDER_ALL);
  const [folderLinkInput, setFolderLinkInput] = useState<string>("");
  const [folderLinkError, setFolderLinkError] = useState<string>("");
  const [count, setCount] = useState<number>(15);
  const [allItems, setAllItems] = useState<boolean>(false);
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("generated");
  const [genFilter, setGenFilter] = useState<GenFilter>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [generatedFrom, setGeneratedFrom] = useState<string>("");
  const [generatedTo, setGeneratedTo] = useState<string>("");
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
  // Subpastas de QUALQUER pasta colada em baseFolderId — não depende mais de
  // Categoria estar mapeada a uma pasta do banco (listBankFolders aceita
  // qualquer parentFolderId do Drive).
  const subFoldersQuery = trpc.catalog.listBankFolders.useQuery(
    { parentFolderId: baseFolderId },
    { enabled: Boolean(user) && Boolean(baseFolderId) },
  );
  const folderPreviewQuery = trpc.catalog.listFolderImages.useQuery(
    { folderId },
    { enabled: Boolean(user) && previewOpen && Boolean(folderId) },
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
      if (res.skippedFiles.length > 0) {
        console.info(
          "[catalog] Puladas por já ter produto (independente do status):",
          res.skippedFiles,
        );
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
  const [orientationMode, setOrientationMode] = useState<OrientationMode>("ambos");
  const exportTrayVariationsMutation =
    trpc.catalog.exportTrayVariations.useMutation({
      onSuccess: (res) => {
        downloadFromMutation({
          fileName: res.fileName,
          mimeType: res.mimeType,
          base64: res.base64,
          rows: res.rows,
        });
        const perProduto = res.products > 0 ? Math.round(res.rows / res.products) : 0;
        toast.success(
          `${res.products} produto(s) → ${res.rows} variações geradas (${perProduto} por produto).`,
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
      },
      onError: (err) => toast.error(err.message),
    });

  const handleVariationsFilePick = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      exportTrayVariationsMutation.mutate({
        fileBase64: dataUrl,
        orientationMode,
      });
    };
    reader.onerror = () => toast.error("Erro ao ler o arquivo");
    reader.readAsDataURL(file);
  };

  const markExportedInputRef = useRef<HTMLInputElement>(null);
  const markExportedMutation = trpc.catalog.markExportedFromTray.useMutation({
    onSuccess: (res) => {
      utils.catalog.listSuggestions.invalidate();
      if (res.atualizados > 0) {
        toast.success(
          `${res.atualizados} produto(s) marcado(s) como Cadastrado na Tray` +
            (res.jaEstavamCadastrados > 0 ? ` (${res.jaEstavamCadastrados} já estavam)` : ""),
        );
      } else if (res.jaEstavamCadastrados > 0) {
        toast.info(`Todos os ${res.jaEstavamCadastrados} produtos encontrados já estavam marcados.`);
      } else {
        toast.warning("Nenhum SKU da planilha bateu com produtos deste catálogo.");
      }
      if (res.naoEncontrados > 0) {
        const preview = res.naoEncontradosSkus.slice(0, 3).join(", ");
        const suffix = res.naoEncontrados > 3 ? `, +${res.naoEncontrados - 3}` : "";
        toast.warning(`${res.naoEncontrados} SKU(s) da planilha não encontrados no catálogo: ${preview}${suffix}`, {
          duration: 8000,
        });
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const handleMarkExportedFilePick = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      markExportedMutation.mutate({ fileBase64: dataUrl });
    };
    reader.onerror = () => toast.error("Erro ao ler o arquivo");
    reader.readAsDataURL(file);
  };

  const syncNamesInputRef = useRef<HTMLInputElement>(null);
  const syncNamesMutation = trpc.catalog.syncTrayCatalogNames.useMutation({
    onSuccess: (res) => {
      toast.success(
        `${res.total} produto(s) da loja sincronizados — a geração de sugestões agora evita repetir esses nomes/URLs.`,
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSyncNamesFilePick = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      syncNamesMutation.mutate({ fileBase64: dataUrl });
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
    const byGenFilter = genFilter === "all"
      ? bySearch
      : bySearch.filter((p) => classifyGen(p) === genFilter);
    const filtered = !generatedFrom && !generatedTo
      ? byGenFilter
      : byGenFilter.filter((p) => {
          const key = generatedDateKey(p.generatedAt ?? p.genCompletedAt);
          if (!key) return false;
          if (generatedFrom && key < generatedFrom) return false;
          if (generatedTo && key > generatedTo) return false;
          return true;
        });
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
  }, [productsQuery.data, statusFilter, genFilter, searchTerm, generatedFrom, generatedTo, sortKey, sortDir]);

  // Paginação: mostra 25 produtos por vez em vez da lista inteira.
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const pagedProducts = useMemo(
    () => visibleProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [visibleProducts, page],
  );
  // Muda o filtro/busca/categoria -> volta pra página 1. Se a lista encolher
  // (ex: menos produtos que a página atual), reenquadra pro último válido.
  useEffect(() => {
    setPage(1);
  }, [categoryId, statusFilter, genFilter, searchTerm, generatedFrom, generatedTo]);
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

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
    // Categoria só define SKU/categoria da Tray — não mexe mais no Folder ID
    // se o usuário já colou/escolheu uma pasta manualmente (senão trocar de
    // categoria apaga um Folder ID/Subpasta que a pessoa já tinha montado).
    // Só pré-preenche como atalho quando o campo ainda está vazio.
    if (!folderId) {
      const cat = categoriesQuery.data?.find((c) => c.id === Number(id));
      const folder = cat && foldersQuery.data?.find((f) => f.name === cat.folderName);
      if (folder) {
        setFolderId(folder.id);
        setBaseFolderId(folder.id);
        setSubFolderId(SUBFOLDER_ALL);
      }
    }
  };

  const handleSelectSubFolder = (id: string) => {
    setSubFolderId(id);
    // SUBFOLDER_ALL = "Todas as subpastas" -> volta a apontar pra pasta base.
    setFolderId(id === SUBFOLDER_ALL ? baseFolderId : id);
  };

  // Ao sair do campo Folder ID editado à mão, esse valor vira a nova "raiz"
  // pra listar subpastas — dispara a consulta só no blur, não a cada tecla.
  const handleFolderIdBlur = () => {
    setBaseFolderId(folderId);
    setSubFolderId(SUBFOLDER_ALL);
  };

  // Pra pastas que ainda não estão mapeadas a nenhuma categoria (ex: banco
  // de imagens de terceiros) — mesma lógica do ImageSelector na geração manual.
  const handleFolderLinkChange = (value: string) => {
    setFolderLinkInput(value);
    setFolderLinkError("");
    if (!value.trim()) return;
    // Não-guloso + lookahead: para a captura no primeiro "/", "?" ou início
    // de outro link colado em seguida sem separador (ex: paste duplicado
    // "https://.../folders/ID_REALhttps://.../folders/ID_REAL"), em vez de
    // engolir o "https" da segunda URL junto com o ID.
    const match = value.match(/\/folders\/([a-zA-Z0-9_-]+?)(?=https?:\/\/|[/?]|$)/);
    if (match) {
      setFolderId(match[1]);
      setBaseFolderId(match[1]);
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

  const exportPayload = () =>
    selectedIds.size > 0
      ? { productIds: Array.from(selectedIds) }
      : { status: statusFilter === "all" ? undefined : (statusFilter as any) };

  return (
    <div className="min-h-screen bg-[#EEECE7] py-8" style={FONT_SANS}>
      <div className="mx-auto max-w-[1360px] overflow-hidden rounded-[14px] border border-black/[.08] bg-white shadow-[0_1px_3px_rgba(0,0,0,.06)]">
        {/* Header */}
        <header className="flex items-start justify-between border-b border-[#EEEDEA] px-8 py-[26px]">
          <div>
            <h1 className="m-0 text-[22px] font-extrabold tracking-[-0.01em] text-[#1C1B1A]">
              Curadoria de Catálogo
            </h1>
            <p className="mt-1.5 text-[13.5px] text-[#8A8680]">
              Passo 1: gerar sugestões a partir do banco de imagens no Drive.
            </p>
          </div>
          <Button
            variant="outline"
            className={GHOST_BTN_CLASS}
            onClick={() => (window.location.href = "/")}
          >
            ← Geração manual
          </Button>
        </header>

        {/* Card "Gerar sugestões por categoria" */}
        <div className="px-8 pt-6">
          <div className="rounded-[10px] border border-[#EEEDEA] bg-[#FCFCFB] p-[22px_24px]">
            <h2 className="m-0 mb-[18px] text-[14.5px] font-extrabold text-[#1C1B1A]">
              Gerar sugestões por categoria
            </h2>
            <div className="grid gap-[22px] sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
              <div>
                <Label className={FIELD_LABEL_CLASS}>Folder ID (cole o ID ou link da pasta)</Label>
                <Input
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  onBlur={handleFolderIdBlur}
                  placeholder="ID da pasta no Drive"
                  className={`${FIELD_INPUT_CLASS} mb-2`}
                />
                <Input
                  value={folderLinkInput}
                  onChange={(e) => handleFolderLinkChange(e.target.value)}
                  placeholder="Ou cole o link de uma pasta do Google Drive"
                  className={`${FIELD_INPUT_CLASS} text-xs ${folderLinkError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  title="Cola o ID ou o link de qualquer pasta do Drive — as subpastas dela aparecem no campo Subpasta ao lado"
                />
                {folderLinkError && (
                  <p className="mt-1 text-xs text-destructive">{folderLinkError}</p>
                )}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="mt-2 h-auto p-0 text-[12.5px] text-[#4338CA]"
                  disabled={!folderId}
                  onClick={() => setPreviewOpen(true)}
                >
                  Ver imagens desta pasta
                </Button>
              </div>
              <div>
                <Label className={FIELD_LABEL_CLASS}>Subpasta (opcional)</Label>
                <Select
                  value={subFolderId}
                  onValueChange={handleSelectSubFolder}
                  disabled={!baseFolderId}
                >
                  <SelectTrigger className={FIELD_INPUT_CLASS}>
                    <SelectValue
                      placeholder={
                        !baseFolderId
                          ? "Cole um Folder ID/link primeiro"
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
              <div>
                <Label className={FIELD_LABEL_CLASS}>Categoria (SKU / Tray)</Label>
                <Select value={categoryId} onValueChange={handleSelectCategory}>
                  <SelectTrigger className={FIELD_INPUT_CLASS}>
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
              <div>
                <Label className={FIELD_LABEL_CLASS}>Quantidade</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  disabled={allItems}
                  onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 15)))}
                  className={FIELD_INPUT_CLASS}
                />
                <label className="mt-[11px] flex items-center gap-[7px] text-[12.5px] text-[#57534E]">
                  <Checkbox
                    checked={allItems}
                    onCheckedChange={(v) => setAllItems(v === true)}
                    className="border-2 border-[#8A8680] data-[state=checked]:border-[#4338CA] data-[state=checked]:bg-[#4338CA]"
                  />
                  Todos os itens da pasta
                </label>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button
                className="rounded-[8px] bg-[#4338CA] px-6 py-[11px] text-[13.5px] font-bold text-white hover:bg-[#3730A3]"
                disabled={!categoryId || !folderId || suggestMutation.isPending}
                onClick={() =>
                  suggestMutation.mutate({
                    folderId,
                    categoryCodeId: Number(categoryId),
                    count,
                    all: allItems,
                  })
                }
              >
                {suggestMutation.isPending ? "Analisando..." : "Gerar sugestões"}
              </Button>
            </div>
          </div>
        </div>

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Imagens da pasta</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto">
              {folderPreviewQuery.isLoading && (
                <p className="py-8 text-center text-sm text-muted-foreground">Carregando imagens...</p>
              )}
              {folderPreviewQuery.isError && (
                <p className="py-8 text-center text-sm text-destructive">
                  Erro ao carregar imagens da pasta.
                </p>
              )}
              {folderPreviewQuery.data && folderPreviewQuery.data.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma imagem encontrada nesta pasta (nem nas subpastas).
                </p>
              )}
              {folderPreviewQuery.data && folderPreviewQuery.data.length > 0 && (
                <>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Mostrando {folderPreviewQuery.data.length} imagem(ns)
                    {folderPreviewQuery.data.length >= 60 && " (limite da pré-visualização — pode haver mais)"}.
                  </p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                    {folderPreviewQuery.data.map((f) => (
                      <div key={f.id} className="space-y-1">
                        <div className="aspect-square overflow-hidden rounded-md border bg-muted">
                          <DriveThumb fileId={f.id} name={f.name} />
                        </div>
                        <p className="truncate text-[10px] text-muted-foreground" title={f.name}>
                          {f.name}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Card "Sugestões" */}
        <div className="px-8 pb-8 pt-7">
          <div className="rounded-[10px] border border-[#EEEDEA] bg-white">
            <div className="flex items-baseline justify-between px-6 pb-4 pt-5">
              <h2 className="m-0 text-[14.5px] font-extrabold text-[#1C1B1A]">Sugestões</h2>
              <span className="text-[12px] text-[#8A8680]" style={FONT_MONO}>
                {visibleProducts.length} produtos
                {productsQuery.data && visibleProducts.length !== productsQuery.data.length && (
                  <> de {productsQuery.data.length}</>
                )}{" "}
                · {selectedIds.size} selecionado(s)
              </span>
            </div>

            {/* Chips de status */}
            <div className="flex flex-wrap gap-2 px-6 pb-[18px]">
              {STATUS_ORDER.filter((s) => statusCounts[s]).map((s) => {
                const active = statusFilter === s;
                const style = STATUS_STYLE[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(active ? "all" : s)}
                    className={`flex items-center gap-1.5 rounded-full border px-[13px] py-[7px] text-[12.5px] font-bold transition-colors ${
                      active
                        ? "border-[#1C1B1A] bg-[#1C1B1A] text-white"
                        : "border-[#E2E0DB] bg-white text-[#57534E] hover:bg-[#F7F6F4]"
                    }`}
                    title={`Filtrar por ${STATUS_LABELS[s]}`}
                  >
                    <span
                      className="h-[7px] w-[7px] rounded-full"
                      style={{ backgroundColor: style.dot }}
                    />
                    {STATUS_LABELS[s]}: {statusCounts[s]}
                  </button>
                );
              })}
            </div>

            <div className="mx-6 border-t border-[#EEEDEA]" />

            {/* Toolbar de ações */}
            <div className="flex flex-wrap items-center gap-[14px] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <Button variant="outline" className={GHOST_BTN_CLASS} onClick={selectAll}>
                  Selecionar todos
                </Button>
                <Button variant="outline" className={GHOST_BTN_CLASS} onClick={clearSelection}>
                  Limpar
                </Button>
              </div>

              <div className="h-6 w-px bg-[#E9E7E2]" />

              <Button
                className="rounded-[7px] bg-[#4338CA] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#3730A3] disabled:bg-[#F1F0EE] disabled:text-[#B4B0A8] disabled:opacity-100"
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
                variant="outline"
                className="rounded-[7px] border border-[#EF4444] px-4 py-2 text-[13px] font-bold text-[#B91C1C] hover:bg-[#FEE2E2] disabled:border-[#E2E0DB] disabled:bg-[#F1F0EE] disabled:text-[#B4B0A8] disabled:opacity-100"
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

              <div className="h-6 w-px bg-[#E9E7E2]" />

              <Select value={styleOverride} onValueChange={(v) => setStyleOverride(v as StyleOverride)}>
                <SelectTrigger
                  className={`${FIELD_INPUT_CLASS} w-56`}
                  title="Estilo de ambiente usado nas imagens lifestyle"
                >
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
                variant="outline"
                className={GHOST_BTN_CLASS}
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

              <div className="h-6 w-px bg-[#E9E7E2]" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-[7px] bg-[#1C1B1A] px-4 py-[9px] text-[13px] font-bold text-white hover:bg-[#1C1B1A]/90"
                  >
                    Exportar ▾
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[190px]">
                  <DropdownMenuItem
                    disabled={exportMutation.isPending}
                    onClick={() => exportMutation.mutate(exportPayload())}
                    title="Planilha interna com metadados da curadoria (descricaoHtml, potencial, palavras-chave)"
                  >
                    Exportar curadoria
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={exportTrayMutation.isPending}
                    onClick={() => exportTrayMutation.mutate(exportPayload())}
                    title="Planilha pronta para importar na Tray (formato 30 colunas)"
                  >
                    Exportar Tray
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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

              <div className="h-6 w-px bg-[#E9E7E2]" />

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Label
                    htmlFor="orientation-mode"
                    className="whitespace-nowrap text-[12px] font-semibold text-[#8A8680]"
                  >
                    Orientação:
                  </Label>
                  <Select
                    value={orientationMode}
                    onValueChange={(v) => setOrientationMode(v as OrientationMode)}
                  >
                    <SelectTrigger
                      id="orientation-mode"
                      className={`${FIELD_INPUT_CLASS} w-44`}
                      title="Ambos: os 8 tamanhos saem em Retrato e Paisagem (16 variações). Somente retrato/paisagem: todos os 8 tamanhos só naquela orientação — use quando a arte não pode ser reenquadrada na outra."
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORIENTATION_MODE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  className={`${GHOST_BTN_CLASS} w-full`}
                  disabled={exportTrayVariationsMutation.isPending}
                  onClick={() => trayVariationsInputRef.current?.click()}
                  title="Suba a planilha de produtos que a Tray exporta após a importação (CSV ou XLSX, com a coluna 'Código produto' preenchida) pra gerar as variações na orientação escolhida acima."
                >
                  {exportTrayVariationsMutation.isPending ? "..." : "Gerar variações"}
                </Button>
              </div>
              <Button
                variant="link"
                className="px-1 text-[13px] font-semibold text-[#4338CA]"
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

              <div className="h-6 w-px bg-[#E9E7E2]" />

              <input
                ref={markExportedInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  handleMarkExportedFilePick(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                className={GHOST_BTN_CLASS}
                disabled={markExportedMutation.isPending}
                onClick={() => markExportedInputRef.current?.click()}
                title="Suba a planilha de produtos exportada pela Tray (CSV ou XLSX) — todo SKU com 'Código produto' preenchido é marcado como Cadastrado na Tray, sem precisar selecionar um por um."
              >
                {markExportedMutation.isPending ? "..." : "Marcar cadastrados (planilha Tray)"}
              </Button>

              <input
                ref={syncNamesInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  handleSyncNamesFilePick(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                className={GHOST_BTN_CLASS}
                disabled={syncNamesMutation.isPending}
                onClick={() => syncNamesInputRef.current?.click()}
                title="Suba a planilha de produtos exportada pela Tray (CSV ou XLSX) pra atualizar a lista de nomes/URLs já usados na loja — evita que a próxima geração de sugestões repita um nome (ou gere a mesma URL) de um produto que já existe na Tray mas nunca passou por este app."
              >
                {syncNamesMutation.isPending ? "..." : "Sincronizar nomes da loja (evitar duplicados)"}
              </Button>
            </div>

            {/* Como funciona (colapsável) */}
            <Collapsible className="mx-6 mb-[18px]">
              <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-[8px] border border-[#E4E3FA] bg-[#F5F5FF] px-4 py-[11px] text-[13px] font-bold text-[#4338CA]">
                <span>ℹ</span> Como funciona
                <span className="ml-auto text-[11px] transition-transform group-data-[state=open]:rotate-180">
                  ▾
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="rounded-b-[8px] border border-t-0 border-[#E4E3FA] bg-[#FAFAFF] px-5 py-4">
                <div className="flex flex-col gap-3">
                  {INSTRUCTION_STEPS.map((step, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-[#4338CA] text-[11.5px] font-bold text-white">
                        {i + 1}
                      </span>
                      <p className="m-0 text-[13px] leading-[1.5] text-[#3A3A3A]">{step}</p>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Linha de filtros */}
            <div className="mx-6 mb-4 grid grid-cols-2 items-end gap-[14px] sm:grid-cols-3 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr_auto]">
              <div>
                <Label htmlFor="catalog-search" className={FIELD_LABEL_CLASS}>
                  Pesquisar
                </Label>
                <Input
                  id="catalog-search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por SKU, nome, marca..."
                  className={FIELD_INPUT_CLASS}
                />
              </div>
              <div>
                <Label htmlFor="catalog-status-filter" className={FIELD_LABEL_CLASS}>
                  Status
                </Label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                  <SelectTrigger id="catalog-status-filter" className={FIELD_INPUT_CLASS}>
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
              </div>
              <div>
                <Label htmlFor="catalog-gen-filter" className={FIELD_LABEL_CLASS}>
                  Geração
                </Label>
                <Select value={genFilter} onValueChange={(v) => setGenFilter(v as GenFilter)}>
                  <SelectTrigger
                    id="catalog-gen-filter"
                    className={FIELD_INPUT_CLASS}
                    title="Filtrar por status de geração de imagens"
                  >
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
              <div>
                <Label htmlFor="catalog-generated-from" className={FIELD_LABEL_CLASS}>
                  Gerado de
                </Label>
                <Input
                  id="catalog-generated-from"
                  type="date"
                  value={generatedFrom}
                  onChange={(e) => setGeneratedFrom(e.target.value)}
                  className={FIELD_INPUT_CLASS}
                  title="Filtrar por data de geração — a partir de"
                />
              </div>
              <div>
                <Label htmlFor="catalog-generated-to" className={FIELD_LABEL_CLASS}>
                  até
                </Label>
                <Input
                  id="catalog-generated-to"
                  type="date"
                  value={generatedTo}
                  onChange={(e) => setGeneratedTo(e.target.value)}
                  className={FIELD_INPUT_CLASS}
                  title="Filtrar por data de geração — até"
                />
              </div>
              {(generatedFrom || generatedTo) && (
                <Button
                  variant="ghost"
                  className="whitespace-nowrap px-1 text-[12.5px] font-semibold text-[#4338CA]"
                  onClick={() => {
                    setGeneratedFrom("");
                    setGeneratedTo("");
                  }}
                >
                  Limpar datas
                </Button>
              )}
            </div>

            {/* Barra de progresso de geração */}
            {generationStatusQuery.data && (generationStatusQuery.data.queued + generationStatusQuery.data.running) > 0 && (
              (() => {
                const s = generationStatusQuery.data;
                const total = s.queued + s.running + s.done + s.errored;
                const pct = total > 0 ? Math.round(((s.done + s.errored) / total) * 100) : 0;
                const remaining = s.queued + s.running;
                const minutesLeft = Math.max(1, Math.ceil(remaining * 1.5));
                return (
                  <div className="mx-6 mb-3 flex items-center gap-3 rounded-[8px] bg-[#EEF2FF] px-4 py-3">
                    <span className="text-[13px]">🎨</span>
                    <span className="text-[12.5px] font-semibold text-[#3730A3]">
                      Geração em andamento: {s.done}/{total} prontos ({pct}%) · ~{minutesLeft} min restantes
                    </span>
                    <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-[#C7D2FE]">
                      <div
                        className="h-full rounded-full bg-[#4338CA] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {s.errored > 0 && (
                      <span className="whitespace-nowrap text-[12.5px] font-bold text-[#B91C1C]">
                        {s.errored} com erro
                      </span>
                    )}
                  </div>
                );
              })()
            )}

            {/* Tabela de sugestões */}
            <div className="overflow-x-auto">
              <div className="min-w-[1100px]">
                <div
                  className="grid items-center gap-3 border-t border-b border-[#EEEDEA] bg-[#FAFAF9] px-6 py-2.5 text-[11px] font-bold uppercase tracking-[0.03em] text-[#8A8680]"
                  style={{ gridTemplateColumns: "40px 56px 1fr 90px 130px 170px 70px" }}
                >
                  <div />
                  <div />
                  <SortableHeader label="Nome" sortKey="nome" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableHeader label="Potencial" sortKey="potencial" current={sortKey} dir={sortDir} onClick={toggleSort} align="center" />
                  <SortableHeader label="Status" sortKey="status" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableHeader label="Geração" sortKey="geracao" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <div>Origem</div>
                </div>

                {pagedProducts.map((p, idx) => {
                  const statusStyle = STATUS_STYLE[p.status as StatusKey];
                  return (
                    <div
                      key={p.id}
                      className="grid items-center gap-3 border-b border-[#F3F2EF] px-6 py-3.5 hover:bg-[#FAFAF9]"
                      style={{ gridTemplateColumns: "40px 56px 1fr 90px 130px 170px 70px" }}
                    >
                      <Checkbox
                        checked={selectedIds.has(p.id)}
                        onCheckedChange={() => toggleSelect(p.id)}
                        className="size-4 border-2 border-[#8A8680] data-[state=checked]:border-[#4338CA] data-[state=checked]:bg-[#4338CA]"
                      />
                      {p.sourceDriveFileId ? (
                        <div className="h-11 w-11 overflow-hidden rounded-[8px] border border-[#EEEDEA]">
                          <DriveThumb fileId={p.sourceDriveFileId} name={p.nome} />
                        </div>
                      ) : (
                        <div
                          className="flex h-11 w-11 items-center justify-center rounded-[8px]"
                          style={{ backgroundColor: THUMB_FALLBACK_COLORS[idx % THUMB_FALLBACK_COLORS.length] }}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <rect x="3" y="4" width="18" height="16" rx="2" stroke="#8A8680" strokeWidth="1.6" />
                            <circle cx="8.5" cy="9.5" r="1.5" fill="#8A8680" />
                            <path d="M4 17l5-5 4 4 3-3 4 4" stroke="#8A8680" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="mb-0.5 truncate text-[11.5px] text-[#8A8680]" style={FONT_MONO}>
                          {p.sku}
                        </div>
                        <div className="truncate text-[13.5px] font-semibold leading-[1.3] text-[#1C1B1A]">
                          {p.nome}
                        </div>
                      </div>
                      <div>
                        <span className="rounded-[6px] bg-[#EEF2FF] px-2.5 py-1 text-[12px] font-bold text-[#4338CA]">
                          {p.aiPotencialVenda ?? "—"}
                        </span>
                      </div>
                      <div>
                        {statusStyle && (
                          <span
                            className="rounded-full px-2.5 py-1 text-[12px] font-bold"
                            style={{ backgroundColor: statusStyle.badgeBg, color: statusStyle.badgeText }}
                          >
                            {STATUS_LABELS[p.status as StatusKey] ?? p.status}
                          </span>
                        )}
                      </div>
                      <div className="text-xs">{generationCellLabel(p)}</div>
                      <div>
                        {p.productDriveFolderUrl ? (
                          <a
                            className="text-[12.5px] font-semibold text-[#4338CA] hover:underline"
                            href={p.productDriveFolderUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Pasta
                          </a>
                        ) : p.sourceDriveFileUrl ? (
                          <a
                            className="text-[12.5px] font-semibold text-[#4338CA] hover:underline"
                            href={p.sourceDriveFileUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Drive
                          </a>
                        ) : (
                          <span className="text-[12.5px] text-[#8A8680]">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {productsQuery.data && visibleProducts.length === 0 && (
                  <div className="px-6 py-8 text-center text-sm text-[#8A8680]">
                    Nenhuma sugestão neste filtro. Gere sugestões acima.
                  </div>
                )}
              </div>
            </div>

            {visibleProducts.length > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-[#EEEDEA] px-6 py-3 text-xs text-[#8A8680]">
                <span>
                  Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visibleProducts.length)} de{" "}
                  {visibleProducts.length}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className={GHOST_BTN_CLASS}
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ← Anterior
                  </Button>
                  <span>
                    Página {page} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    className={GHOST_BTN_CLASS}
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Próxima →
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
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
  generatedAt?: Date | string | null;
};

function formatDatePtBr(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR");
}

/** Chave "YYYY-MM-DD" em horário local, comparável com o valor de <input type="date">. */
function generatedDateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function classifyGen(p: GenInfo): Exclude<GenFilter, "all"> {
  if (p.imageUrl1 && p.imageUrl2 && p.imageUrl3) return "generated";
  if (p.genError && p.genCompletedAt) return "failed";
  if (p.genStartedAt && !p.genCompletedAt) return "in_progress";
  if (p.genQueuedAt) return "queued";
  return "none";
}

function SortableHeader({
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
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={`inline-flex items-center gap-1 uppercase tracking-[0.03em] text-[#8A8680] hover:text-[#1C1B1A] ${
        align === "center" ? "justify-center" : "justify-start"
      } ${active ? "text-[#1C1B1A]" : ""}`}
    >
      {label}
      <span className="text-[10px]">{arrow || "↕"}</span>
    </button>
  );
}

function generationCellLabel(p: GenInfo): React.ReactNode {
  if (p.genError && p.genCompletedAt) {
    return <span className="text-destructive" title={p.genError}>❌ falha</span>;
  }
  if (p.imageUrl1 && p.imageUrl2 && p.imageUrl3) {
    const date = formatDatePtBr(p.generatedAt ?? p.genCompletedAt);
    return (
      <span className="font-medium text-emerald-600">
        ✅ pronto{date ? <span className="ml-1 font-normal text-[#8A8680]">({date})</span> : null}
      </span>
    );
  }
  if (p.genStartedAt && !p.genCompletedAt) {
    return <span className="text-blue-600">⚙️ gerando {p.genStep ?? 0}/3</span>;
  }
  if (p.genQueuedAt) return <span className="text-amber-600">⏳ na fila</span>;
  return <span className="text-xs text-[#8A8680]">não gerado</span>;
}
