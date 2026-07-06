import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import ExcelJS from "exceljs";
import { protectedProcedure, router } from "../_core/trpc";
import { getValidAccessToken } from "../_core/oauth";
import { googleDriveService, extractDriveFileId } from "../services/googleDriveService";
import { analyzeImageForCatalog, buildSku, buildSlug } from "../services/catalogService";
import { getDb } from "../db";
import { categoryCodes, products, productStatusEnum } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import type { FrameType } from "../services/catalogPipeline";

// Mesmo conjunto de StyleType do promptAgentService — repetido como tupla
// literal aqui pra alimentar o z.enum (mesmo padrão usado em generationRouter.ts).
const STYLE_TYPES = [
  "goquadros_signature",
  "scandinavian",
  "japandi",
  "minimalist",
  "boho",
  "classic",
  "contemporary",
  "mid_century_br",
  "brazilian_modern",
] as const;

async function requireAccessToken(openId: string): Promise<string> {
  const accessToken = await getValidAccessToken(openId);
  if (!accessToken) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Faça login com Google para acessar o Drive",
    });
  }
  return accessToken;
}

/**
 * Parser CSV simples para o formato exportado pela Tray:
 *  - separador ';'
 *  - campos entre aspas duplas; '""' escapa uma aspa literal
 *  - quebras de linha dentro de aspas fazem parte do campo (HTML da descrição)
 * Retorna a matriz de strings (uma linha por registro).
 */
function parseCsvSemicolon(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ";") {
        row.push(field);
        field = "";
      } else if (ch === "\r") {
        // ignora, espera o \n
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  // último campo / linha sem newline final
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Transforma URLs antigas salvas no DB (formato `uc?export=download&id=...`)
 * em URLs do proxy `/img/<id>.jpg` que a Tray aceita. Sem isso, produtos
 * gerados antes desse fix continuam quebrando na importação.
 */
function toTrayImageUrl(saved: string | null | undefined): string {
  if (!saved) return "";
  return googleDriveService.publicDownloadUrl(extractDriveFileId(saved));
}

/**
 * Valor exato aceito pelo campo "Quando acabar o estoque" da Tray (dicionário
 * oficial de campos de importação/exportação de produto). Compartilhado entre
 * `exportTrayImport` (nível produto) e `exportTrayVariations` (nível variação).
 */
const QUANDO_ACABAR_ESTOQUE = "Manter ativo, mas não permitir vendas";

/**
 * Preço de custo padrão e markup aplicados a TODO produto exportado — o
 * preço de venda é sempre custo × markup, nunca um valor solto (confirmado
 * com a Priscila em 2026-07-05: venda = custo × 3,5).
 */
const PRECO_CUSTO_PADRAO = 73.0;
const MARKUP_VENDA = 3.5;

/**
 * Defaults operacionais fixos pro export de importação Tray (`exportTrayImport`)
 * — confirmados com a Priscila em 2026-07-04. Aplicados a TODO produto
 * exportado, independente do que estiver salvo em precoVenda/precoCusto/
 * pesoGramas/dimensões no DB (esses campos no DB continuam existindo pra
 * outros usos, mas a loja padronizou esses valores pra loja toda).
 */
const TRAY_EXPORT_DEFAULTS = {
  precoVenda: PRECO_CUSTO_PADRAO * MARKUP_VENDA,
  precoCusto: PRECO_CUSTO_PADRAO,
  pesoGramas: 2470,
  comprimentoCm: 65,
  larguraCm: 45,
  alturaCm: 9,
  mensagemAdicional: "Este quadro não tem opção do acabamento vidro.",
  quandoAcabarEstoque: QUANDO_ACABAR_ESTOQUE,
} as const;

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Banco de dados indisponível",
    });
  }
  return db;
}

export const catalogRouter = router({
  /**
   * Lista as subpastas do banco de imagens (origem do passo 1).
   * Default: pasta raiz definida em DRIVE_BANK_FOLDER_ID.
   */
  listBankFolders: protectedProcedure
    .input(z.object({ parentFolderId: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const accessToken = await requireAccessToken(ctx.user.openId);
      const parentId = input?.parentFolderId || ENV.driveBankFolderId;
      if (!parentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "DRIVE_BANK_FOLDER_ID não configurado e parentFolderId não informado",
        });
      }

      const folders = await googleDriveService.listFolders(accessToken, parentId);

      // Cruza com category_codes pra mostrar quais já têm mapeamento
      const db = await getDb();
      const codes = db ? await db.select().from(categoryCodes) : [];
      const codeByName = new Map(codes.map((c) => [c.folderName, c]));

      return folders.map((f) => ({
        id: f.id,
        name: f.name,
        mapped: codeByName.has(f.name),
        code3: codeByName.get(f.name)?.code3 ?? null,
        categoryCodeId: codeByName.get(f.name)?.id ?? null,
      }));
    }),

  /**
   * Passo 1: lê N imagens da pasta de uma categoria, manda cada uma pro
   * Gemini Vision e persiste sugestões em `products` com status="suggested".
   *
   * Retorna progresso resumido (a UI faz polling de listSuggestions).
   */
  suggestProducts: protectedProcedure
    .input(
      z.object({
        folderId: z.string().min(1),
        categoryCodeId: z.number().int().positive(),
        count: z.number().int().min(1).max(50).default(15),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const accessToken = await requireAccessToken(ctx.user.openId);

      const [category] = await db
        .select()
        .from(categoryCodes)
        .where(eq(categoryCodes.id, input.categoryCodeId))
        .limit(1);
      if (!category) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Categoria não encontrada" });
      }

      // Recursivo: a pasta-mãe da categoria pode não ter imagens diretas,
      // só sub-subpastas (ex: "#PN Paisagens Naturais" → #PN01 Cachoeiras → imagens).
      const files = await googleDriveService.listImagesRecursive(accessToken, input.folderId, {
        maxDepth: 3,
        maxFiles: Math.max(input.count * 5, 50),
      });
      const slice = files.slice(0, input.count);
      if (slice.length === 0) {
        return { processed: 0, succeeded: 0, failed: 0, skipped: 0, errors: [] };
      }

      // Calcula próximo seq (continua a sequência global por categoria)
      const existing = await db
        .select({ sku: products.sku })
        .from(products)
        .where(eq(products.categoryCodeId, category.id));
      let nextSeq = existing.length + 1;

      const errors: { fileName: string; reason: string }[] = [];
      let succeeded = 0;
      let skipped = 0;

      for (const file of slice) {
        // Skip se já existe sugestão pra esse arquivo (idempotência)
        const dup = await db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.sourceDriveFileId, file.id), eq(products.userId, ctx.user.id)))
          .limit(1);
        if (dup.length > 0) {
          skipped += 1;
          continue;
        }

        try {
          const dataUrl = await googleDriveService.getFileContent(
            accessToken,
            file.id,
            file.mimeType,
          );

          const ai = await analyzeImageForCatalog({
            imageDataUrl: dataUrl,
            categoria: category.displayName,
            fileName: file.name,
          });

          const sku = buildSku({
            cat3: category.code3,
            seq: nextSeq,
            variant: 1,
            nome: ai.nome,
          });
          nextSeq += 1;

          await db.insert(products).values({
            userId: ctx.user.id,
            categoryCodeId: category.id,
            sku,
            nome: ai.nome,
            descricaoHtml: ai.descricaoHtml,
            slugSeo: buildSlug(ai.nome),
            sourceDriveFileId: file.id,
            sourceDriveFileUrl: file.webViewLink,
            aiPotencialVenda: ai.potencialVenda,
            aiPalavrasChave: ai.palavrasChave.join(", "),
            aiPublicoAlvo: ai.publicoAlvo,
            modelo: sku,
            status: "suggested",
          });
          succeeded += 1;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`[catalog] Falha analisando ${file.name}:`, reason);
          errors.push({ fileName: file.name, reason });
        }
      }

      return {
        processed: slice.length,
        succeeded,
        failed: errors.length,
        skipped,
        errors,
      };
    }),

  /**
   * Lista produtos do usuário (com filtro opcional por status/categoria).
   * Usado pela UI de curadoria.
   */
  listSuggestions: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(productStatusEnum).optional(),
          categoryCodeId: z.number().int().positive().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const db = await requireDb();
      const conditions = [eq(products.userId, ctx.user.id)];
      if (input?.status) conditions.push(eq(products.status, input.status));
      if (input?.categoryCodeId)
        conditions.push(eq(products.categoryCodeId, input.categoryCodeId));

      const rows = await db
        .select()
        .from(products)
        .where(and(...conditions))
        .orderBy(desc(products.aiPotencialVenda), desc(products.createdAt))
        .limit(500);
      return rows;
    }),

  /**
   * Aprovação/rejeição em lote durante a curadoria.
   */
  updateProductStatus: protectedProcedure
    .input(
      z.object({
        productIds: z.array(z.number().int().positive()).min(1).max(500),
        // "exported" = marcação manual de "Cadastrado na Tray" (produto já
        // importado + variações geradas na loja) — não tem como detectar
        // isso automaticamente porque a importação acontece no painel da
        // Tray, fora do sistema.
        status: z.enum(["approved", "rejected", "exported"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const setClause: Record<string, unknown> = { status: input.status };
      if (input.status === "approved") setClause.approvedAt = new Date();
      if (input.status === "exported") setClause.exportedAt = new Date();

      await db
        .update(products)
        .set(setClause)
        .where(and(eq(products.userId, ctx.user.id), inArray(products.id, input.productIds)));
      return { updated: input.productIds.length };
    }),

  /**
   * Edição manual de campos do produto durante curadoria
   * (corrige nome/descrição/potencialVenda gerados pela IA).
   */
  updateProduct: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        nome: z.string().min(3).max(255).optional(),
        descricaoHtml: z.string().optional(),
        slugSeo: z.string().max(255).optional(),
        aiPotencialVenda: z.number().int().min(1).max(10).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const { id, ...patch } = input;
      await db
        .update(products)
        .set(patch)
        .where(and(eq(products.userId, ctx.user.id), eq(products.id, id)));
      return { id };
    }),

  /**
   * Exporta a planilha de catálogo (formato Catalogo_Quadros_Tray_COM_IMAGENS.xlsx).
   * Cliente recebe base64 e dispara download.
   */
  exportSuggestions: protectedProcedure
    .input(
      z.object({
        productIds: z.array(z.number().int().positive()).optional(),
        status: z.enum(productStatusEnum).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const conditions = [eq(products.userId, ctx.user.id)];
      if (input.status) conditions.push(eq(products.status, input.status));
      if (input.productIds && input.productIds.length > 0) {
        conditions.push(inArray(products.id, input.productIds));
      }

      const rows = await db
        .select()
        .from(products)
        .where(and(...conditions))
        .orderBy(desc(products.aiPotencialVenda), desc(products.createdAt));

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Catálogo - Tray");
      ws.columns = [
        { header: "Referência (código fornecedor)", key: "sku", width: 60 },
        { header: "Código do produto (ID)", key: "id", width: 12 },
        { header: "Nome do produto", key: "nome", width: 60 },
        { header: "Preço de venda em reais", key: "precoVenda", width: 16 },
        { header: "Preço de custo em reais", key: "precoCusto", width: 16 },
        { header: "Estoque do produto", key: "estoque", width: 12 },
        { header: "Exibir produto ativo", key: "ativo", width: 12 },
        { header: "NCM do produto", key: "ncm", width: 14 },
        { header: "Prazo de disponibilidade", key: "prazo", width: 14 },
        { header: "SEO - Endereço do produto (URL)", key: "slug", width: 50 },
        { header: "Peso do produto (gramas)", key: "peso", width: 12 },
        { header: "Largura (cm)", key: "largura", width: 10 },
        { header: "Altura (cm)", key: "altura", width: 10 },
        { header: "Comprimento (cm)", key: "comprimento", width: 14 },
        { header: "Imagem_Mapeada", key: "imagemMapeada", width: 50 },
        { header: "Pasta_Drive", key: "pastaDrive", width: 60 },
        { header: "Status_Imagem", key: "statusImagem", width: 16 },
        { header: "Descricao_HTML", key: "descricaoHtml", width: 80 },
        { header: "AI_Potencial_Venda", key: "potencial", width: 14 },
        { header: "AI_Palavras_Chave", key: "palavras", width: 40 },
        { header: "AI_Publico_Alvo", key: "publico", width: 30 },
        { header: "Status", key: "status", width: 14 },
      ];
      ws.getRow(1).font = { bold: true };

      for (const p of rows) {
        ws.addRow({
          sku: p.sku,
          id: 1000 + p.id,
          nome: p.nome,
          precoVenda: Number(p.precoVenda),
          precoCusto: Number(p.precoCusto),
          estoque: p.estoque,
          ativo: p.exibirAtivo ? 1 : 0,
          ncm: p.ncm,
          prazo: p.prazoDisponibilidade,
          slug: p.slugSeo ?? "",
          peso: p.pesoGramas,
          largura: Number(p.larguraCm),
          altura: Number(p.alturaCm),
          comprimento: Number(p.comprimentoCm),
          imagemMapeada: p.sourceDriveFileId ?? "",
          pastaDrive: p.productDriveFolderUrl ?? p.sourceDriveFileUrl ?? "",
          statusImagem: p.productDriveFolderId ? "✅ Mapeado" : "⏳ Pendente",
          descricaoHtml: p.descricaoHtml ?? "",
          potencial: p.aiPotencialVenda ?? "",
          palavras: p.aiPalavrasChave ?? "",
          publico: p.aiPublicoAlvo ?? "",
          status: p.status,
        });
      }

      const buffer = await wb.xlsx.writeBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const fileName = `Catalogo_Quadros_${new Date().toISOString().slice(0, 10)}.xlsx`;
      return {
        fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64,
        rows: rows.length,
      };
    }),

  /**
   * Exporta planilha NO FORMATO DE IMPORTAÇÃO DA TRAY
   * (mesmo layout do Modelo_Produtos_Preenchido.xlsx — 23 colunas).
   * Os campos de URL de imagem ficam vazios se ainda não foram processados.
   */
  exportTrayImport: protectedProcedure
    .input(
      z.object({
        productIds: z.array(z.number().int().positive()).optional(),
        status: z.enum(productStatusEnum).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      console.log("[catalog.exportTrayImport] input:", {
        status: input.status,
        productIdsCount: input.productIds?.length ?? 0,
        productIds: input.productIds,
      });
      const conditions = [eq(products.userId, ctx.user.id)];
      if (input.status) conditions.push(eq(products.status, input.status));
      if (input.productIds && input.productIds.length > 0) {
        conditions.push(inArray(products.id, input.productIds));
      }

      const allRows = await db
        .select({
          p: products,
          c: categoryCodes,
        })
        .from(products)
        .leftJoin(categoryCodes, eq(products.categoryCodeId, categoryCodes.id))
        .where(and(...conditions))
        .orderBy(desc(products.aiPotencialVenda), desc(products.createdAt));

      // Produtos sem imageUrl1 são ignorados: subir na Tray com células de
      // imagem vazias resulta em produtos sem foto. Devolvemos a lista de
      // skipped pra UI alertar a usuária — em geral significa que esses
      // produtos ainda não passaram pelo pipeline de geração.
      const rows = allRows.filter((r) => r.p.imageUrl1);
      const skipped = allRows
        .filter((r) => !r.p.imageUrl1)
        .map((r) => ({ id: r.p.id, sku: r.p.sku, nome: r.p.nome }));
      // Produtos gerados antes da Etapa 4 (mockup por cor de moldura) não
      // têm mockupUrlLightWood/DarkWood/White/Black — a variação por cor
      // fica em branco na planilha do produto principal e a usuária
      // precisa regenerar as imagens desses produtos.
      const skusSemMockupPorMoldura = rows
        .filter(
          (r) =>
            !r.p.mockupUrlLightWood ||
            !r.p.mockupUrlDarkWood ||
            !r.p.mockupUrlWhite ||
            !r.p.mockupUrlBlack,
        )
        .map((r) => r.p.sku);

      // Layout do template oficial de importação da Tray, confirmado em
      // 2026-07-05 com o dicionário de campos do painel: o produto aceita
      // 7 posições de imagem (colunas 5-11: principal + "2" até "7"), não
      // só 4 como a versão anterior assumia. As colunas seguintes (preço,
      // peso, etc.) foram todas deslocadas 3 posições pra abrir espaço.
      // A Tray casa colunas pelo texto do header — por isso os headers
      // abaixo usam o nome EXATO de cada campo no dicionário oficial.
      // Colunas 1 e 2 ("Código do produto (ID)" e "Código da categoria
      // principal (ID)") são numéricas — deixadas em branco para criar
      // produtos novos (Tray gera os IDs); preencher só ao atualizar.

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Worksheet");
      ws.columns = [
        { header: "Código do produto (ID)", key: "id", width: 14 },
        { header: "Código da categoria principal (ID)", key: "catId", width: 18 },
        { header: "Nome do produto", key: "nome", width: 60 },
        { header: "HTML da descrição completa", key: "html", width: 80 },
        { header: "Endereço da imagem principal do produto", key: "img1", width: 50 },
        { header: "Endereço da imagem do produto 2", key: "img2", width: 50 },
        { header: "Endereço da imagem do produto 3", key: "img3", width: 50 },
        { header: "Endereço da imagem do produto 4", key: "img4", width: 50 },
        { header: "Endereço da imagem do produto 5", key: "img5", width: 50 },
        { header: "Endereço da imagem do produto 6", key: "img6", width: 50 },
        { header: "Endereço da imagem do produto 7", key: "img7", width: 50 },
        { header: "Preço de venda em reais", key: "precoVenda", width: 16 },
        { header: "Peso do produto (gramas)", key: "peso", width: 14 },
        { header: "Estoque do produto", key: "estoque", width: 12 },
        { header: "Estoque mínimo para aviso", key: "estoqueMin", width: 12 },
        { header: "Exibir selo destaque na loja", key: "seloDestaque", width: 14 },
        { header: "Exibir selo de lançamento", key: "seloLancamento", width: 14 },
        { header: "Exibir selo adicional", key: "seloAdicional", width: 14 },
        { header: "Marca", key: "marca", width: 16 },
        { header: "Modelo", key: "modelo", width: 30 },
        { header: "Referência (código fornecedor)", key: "sku", width: 60 },
        { header: "Tempo de garantia", key: "garantia", width: 14 },
        { header: "Preço de custo em reais", key: "precoCusto", width: 16 },
        { header: "Comprimento (cm)", key: "comprimento", width: 14 },
        { header: "Largura (cm)", key: "largura", width: 10 },
        { header: "Altura (cm)", key: "altura", width: 10 },
        { header: "SEO - Titulo do produto", key: "seoTitulo", width: 40 },
        { header: "SEO - Descrição simplificada", key: "seoDesc", width: 50 },
        { header: "SEO - Palavras chaves do produto", key: "seoKeywords", width: 40 },
        { header: "SEO - Endereço do produto (URL)", key: "slug", width: 50 },
        { header: "Nome da categoria - nível 1", key: "catN1", width: 22 },
        { header: "Nome da categoria - nível 2", key: "catN2", width: 22 },
        { header: "Exibir na loja", key: "naLoja", width: 12 },
        { header: "Mensagem adicional", key: "mensagemAdicional", width: 50 },
        { header: "Quando acabar o estoque", key: "quandoAcabarEstoque", width: 22 },
      ];
      ws.getRow(1).font = { bold: true };

      for (const { p, c } of rows) {
        // SEO description = primeira frase do HTML (sem tags), max ~160 chars
        const plainText = (p.descricaoHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const seoDesc = plainText.slice(0, 160);

        ws.addRow({
          // null deixa célula em branco. String vazia "" quebra com
          // "Somente valor numérico permitido" — Tray quer literalmente nada
          // pra gerar IDs novos.
          id: null,
          catId: null,
          nome: p.nome,
          html: p.descricaoHtml ?? "",
          // Ordem confirmada com a Priscila em 2026-07-05: as 2 lifestyles,
          // depois as 4 cores de moldura do mockup, e a arte original
          // web-fit (sem moldura/ambiente) por último.
          img1: toTrayImageUrl(p.imageUrl2), // lifestyle 1
          img2: toTrayImageUrl(p.imageUrl3), // lifestyle 2
          img3: toTrayImageUrl(p.mockupUrlLightWood), // mockup Amadeirado claro
          img4: toTrayImageUrl(p.mockupUrlDarkWood), // mockup Amadeirado escuro
          img5: toTrayImageUrl(p.mockupUrlWhite), // mockup Branca
          img6: toTrayImageUrl(p.mockupUrlBlack), // mockup Preta
          img7: toTrayImageUrl(p.imageUrl1), // arte original web-fit
          precoVenda: TRAY_EXPORT_DEFAULTS.precoVenda,
          peso: TRAY_EXPORT_DEFAULTS.pesoGramas,
          estoque: p.estoque,
          estoqueMin: 5,
          seloDestaque: 0,
          seloLancamento: 0,
          seloAdicional: 0,
          marca: p.marca,
          modelo: p.modelo ?? p.sku,
          sku: p.sku,
          garantia: p.tempoGarantia,
          precoCusto: TRAY_EXPORT_DEFAULTS.precoCusto,
          comprimento: TRAY_EXPORT_DEFAULTS.comprimentoCm,
          largura: TRAY_EXPORT_DEFAULTS.larguraCm,
          altura: TRAY_EXPORT_DEFAULTS.alturaCm,
          seoTitulo: p.nome,
          seoDesc,
          seoKeywords: p.aiPalavrasChave ?? "",
          slug: p.slugSeo ?? "",
          catN1: c?.trayCategoriaPrincipal ?? "Temas",
          catN2: c?.traySubcategoria ?? "",
          naLoja: p.exibirNaLoja ? "Sim" : "Não",
          mensagemAdicional: TRAY_EXPORT_DEFAULTS.mensagemAdicional,
          quandoAcabarEstoque: TRAY_EXPORT_DEFAULTS.quandoAcabarEstoque,
        });
      }

      const buffer = await wb.xlsx.writeBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const fileName = `Tray_Import_${new Date().toISOString().slice(0, 10)}.xlsx`;
      return {
        fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64,
        rows: rows.length,
        skipped,
        skusSemMockupPorMoldura,
      };
    }),

  /**
   * Gera planilha de variações Tray a partir do XLSX/CSV de produtos
   * exportado pela Tray (com a coluna "Código do produto (ID)" preenchida).
   *
   * Fluxo (round-trip):
   *  1. Usuária importa produtos via `exportTrayImport` → Tray atribui IDs.
   *  2. Usuária baixa do painel da Tray a planilha de produtos com os IDs.
   *  3. Aqui: lemos esse arquivo, pegamos o ID Tray de cada produto e
   *     emitimos 32 linhas por produto (4 molduras × 8 tamanhos), no
   *     layout validado por importação manual bem-sucedida no painel da
   *     Tray (planilha "1480066_23486_Qtok_variacaoes.xlsx"): coluna A em
   *     branco, depois Código do produto (ID), Código da variação (ID),
   *     Nome da variação 1, Nome da variação 2, Tipo da variação 1, Tipo
   *     da variação 2, Estoque da variação, Estoque mínimo para aviso,
   *     Quando acabar o estoque, Altura, Comprimento, Largura, Peso.
   */
  exportTrayVariations: protectedProcedure
    .input(z.object({ fileBase64: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();

      // Matrix fixo: 4 molduras × 8 tamanhos = 32 variações por produto.
      // Altura constante 9cm; largura e comprimento da embalagem crescem
      // com o tamanho do quadro (tabela operacional da Qtok Quadros).
      const MOLDURAS = [
        "Amadeirado claro",
        "Amadeirado escuro",
        "Branca",
        "Preta",
      ] as const;
      // Relaciona cada nome de moldura (valor da variação, como aparece na
      // Tray) com o FrameType usado pelo pipeline pra gerar o mockup
      // correspondente — é essa relação que resolve qual foto vai em
      // "Endereço da imagem principal da variação" de cada linha.
      const MOLDURA_TO_FRAME: Record<(typeof MOLDURAS)[number], FrameType> = {
        "Amadeirado claro": "light_wood",
        "Amadeirado escuro": "dark_wood",
        "Branca": "white",
        "Preta": "black",
      };
      type SizeRow = {
        nome: string;
        altura: number;
        largura: number;
        comprimento: number;
        pesoGramas: number;
        precoCusto: number;
      };
      // Pesos "embalado c/ moldura" e preço de custo por medida (tabela
      // confirmada com a Priscila em 2026-07-05) — preço de venda de cada
      // variação é sempre custo × MARKUP_VENDA, igual ao produto principal.
      const TAMANHOS: SizeRow[] = [
        { nome: "60cm x 40cm",   altura: 9, largura: 45,  comprimento: 65,  pesoGramas: 2470, precoCusto: 73.0 },
        { nome: "70cm x 50cm",   altura: 9, largura: 55,  comprimento: 75,  pesoGramas: 2950, precoCusto: 100.0 },
        { nome: "80cm x 55cm",   altura: 9, largura: 60,  comprimento: 85,  pesoGramas: 3330, precoCusto: 127.0 },
        { nome: "90cm x 60cm",   altura: 9, largura: 65,  comprimento: 95,  pesoGramas: 4020, precoCusto: 165.0 },
        { nome: "100cm x 70cm",  altura: 9, largura: 75,  comprimento: 105, pesoGramas: 4450, precoCusto: 196.0 },
        { nome: "120cm x 80cm",  altura: 9, largura: 85,  comprimento: 125, pesoGramas: 5560, precoCusto: 242.0 },
        { nome: "150cm x 100cm", altura: 9, largura: 105, comprimento: 155, pesoGramas: 7880, precoCusto: 300.0 },
        { nome: "160cm x 110cm", altura: 9, largura: 115, comprimento: 165, pesoGramas: 9000, precoCusto: 318.0 },
      ];
      const ESTOQUE_POR_VARIACAO = 99;

      // Aceita data URL (data:...;base64,XXX) ou base64 puro.
      const b64 = input.fileBase64.includes(",")
        ? input.fileBase64.slice(input.fileBase64.indexOf(",") + 1)
        : input.fileBase64;
      const buffer = Buffer.from(b64, "base64");

      // Tray hoje exporta produtos em CSV (separador ';', encoding cp1252).
      // A planilha de produtos do template oficial pode vir em XLSX também,
      // então sniffamos pelo magic number do ZIP (XLSX é um zip).
      const isXlsx =
        buffer.length >= 4 &&
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);

      // Localiza as colunas por header — match flexível porque o nome
      // muda entre o CSV de exportação ("Código produto", "Referência")
      // e o XLSX de importação ("Código do produto (ID)", "Referência
      // (código fornecedor)").
      const isIdHeader = (s: string) => {
        const t = s.trim().toLowerCase();
        return t === "código produto" || t === "código do produto (id)";
      };
      const isRefHeader = (s: string) => s.trim().toLowerCase().startsWith("referência");

      type Pair = { sku: string; trayId: number };
      const pairs: Pair[] = [];
      const skippedSkus: string[] = [];

      if (isXlsx) {
        const wbIn = new ExcelJS.Workbook();
        try {
          // ExcelJS aceita ArrayBuffer/Uint8Array; tipos do node 22 e ExcelJS
          // divergem no Buffer<ArrayBufferLike> genérico, então passamos o
          // ArrayBuffer subjacente.
          const ab = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ) as ArrayBuffer;
          await wbIn.xlsx.load(ab);
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Arquivo XLSX inválido. Exporte a planilha de produtos no painel da Tray (CSV ou XLSX) e tente novamente.",
          });
        }
        const ws = wbIn.worksheets[0];
        if (!ws) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Planilha vazia — nenhuma aba encontrada.",
          });
        }
        // O painel da Tray às vezes prefixa a planilha com uma linha de
        // título (nome do arquivo) antes do cabeçalho de verdade, então
        // procuramos o cabeçalho nas primeiras linhas em vez de assumir
        // que está sempre na linha 1.
        let idCol = -1;
        let refCol = -1;
        let headerRowNumber = -1;
        const HEADER_SEARCH_ROWS = 5;
        for (let r = 1; r <= Math.min(HEADER_SEARCH_ROWS, ws.rowCount); r++) {
          const row = ws.getRow(r);
          let foundId = -1;
          let foundRef = -1;
          row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            const text = String(cell.value ?? "");
            if (isIdHeader(text)) foundId = colNumber;
            if (isRefHeader(text)) foundRef = colNumber;
          });
          if (foundId !== -1 && foundRef !== -1) {
            idCol = foundId;
            refCol = foundRef;
            headerRowNumber = r;
            break;
          }
        }
        if (idCol === -1 || refCol === -1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Não achei as colunas 'Código produto' e 'Referência' no cabeçalho. Confirme que é a planilha de produtos exportada pela Tray.",
          });
        }
        for (let r = headerRowNumber + 1; r <= ws.rowCount; r++) {
          const row = ws.getRow(r);
          const sku = String(row.getCell(refCol).value ?? "").trim();
          const idRaw = row.getCell(idCol).value;
          if (!sku) continue;
          const idNum =
            typeof idRaw === "number"
              ? idRaw
              : typeof idRaw === "string"
                ? Number(idRaw.trim())
                : NaN;
          if (!Number.isFinite(idNum) || idNum <= 0) {
            skippedSkus.push(sku);
            continue;
          }
          pairs.push({ sku, trayId: idNum });
        }
      } else {
        // CSV da Tray: encoding cp1252 (windows-1252), separador ';',
        // campos podem estar entre aspas duplas e conter '"' escapado
        // como '""' e quebras de linha dentro do HTML da descrição.
        let text: string;
        try {
          text = new TextDecoder("windows-1252").decode(buffer);
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Não consegui ler o arquivo. Use o CSV ou XLSX de produtos exportado pelo painel da Tray.",
          });
        }
        // BOM UTF-8 caso a Tray exporte em UTF-8 em alguma versão.
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

        const rows = parseCsvSemicolon(text);
        if (rows.length < 2) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "CSV sem linhas de dados. Verifique se exportou o arquivo certo.",
          });
        }
        // Mesma cautela do XLSX: a Tray às vezes prefixa o arquivo com uma
        // linha de título antes do cabeçalho de verdade.
        let idCol = -1;
        let refCol = -1;
        let headerRowIndex = -1;
        const HEADER_SEARCH_ROWS = 5;
        for (let r = 0; r < Math.min(HEADER_SEARCH_ROWS, rows.length); r++) {
          const foundId = rows[r].findIndex(isIdHeader);
          const foundRef = rows[r].findIndex(isRefHeader);
          if (foundId !== -1 && foundRef !== -1) {
            idCol = foundId;
            refCol = foundRef;
            headerRowIndex = r;
            break;
          }
        }
        if (idCol === -1 || refCol === -1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Não achei as colunas 'Código produto' e 'Referência' no cabeçalho. Confirme que é a planilha de produtos exportada pela Tray.",
          });
        }
        for (let r = headerRowIndex + 1; r < rows.length; r++) {
          const row = rows[r];
          const sku = (row[refCol] ?? "").trim();
          if (!sku) continue;
          const idNum = Number((row[idCol] ?? "").trim());
          if (!Number.isFinite(idNum) || idNum <= 0) {
            skippedSkus.push(sku);
            continue;
          }
          pairs.push({ sku, trayId: idNum });
        }
      }

      if (pairs.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Nenhum produto com 'Código produto' preenchido. Importe os produtos na Tray primeiro, depois exporte de novo.",
        });
      }

      // Busca os mockups por cor de moldura de cada produto (gerados na
      // Etapa 4 do pipeline) pra preencher a imagem de cada variação.
      const skus = pairs.map((p) => p.sku);
      const mockupRows = await db
        .select({
          sku: products.sku,
          mockupUrlLightWood: products.mockupUrlLightWood,
          mockupUrlDarkWood: products.mockupUrlDarkWood,
          mockupUrlWhite: products.mockupUrlWhite,
          mockupUrlBlack: products.mockupUrlBlack,
        })
        .from(products)
        .where(and(eq(products.userId, ctx.user.id), inArray(products.sku, skus)));

      const mockupBySku = new Map<string, Record<FrameType, string | null>>(
        mockupRows.map((r) => [
          r.sku,
          {
            light_wood: r.mockupUrlLightWood,
            dark_wood: r.mockupUrlDarkWood,
            white: r.mockupUrlWhite,
            black: r.mockupUrlBlack,
          },
        ]),
      );
      // Produtos gerados antes desta feature não têm mockup por moldura —
      // a linha da variação fica sem imagem (Tray usa a imagem principal do
      // produto como fallback), mas avisamos a usuária pra ela saber que
      // precisa re-gerar esses produtos se quiser a foto por moldura.
      const skusSemMockupPorMoldura = pairs
        .filter((p) => !mockupBySku.get(p.sku))
        .map((p) => p.sku);

      // Estoque mínimo para aviso e comportamento ao esgotar, constantes
      // para todas as variações — valores confirmados na importação manual
      // que funcionou no painel da Tray. QUANDO_ACABAR_ESTOQUE é compartilhada
      // com `exportTrayImport` (mesmo valor no nível produto e variação).
      const ESTOQUE_MINIMO_AVISO = 5;
      const TIPO_VARIACAO_1 = "Moldura";
      const TIPO_VARIACAO_2 = "Tamanho";

      // Layout validado por importação manual bem-sucedida no painel da
      // Tray. A coluna A fica em branco (espaçador do template oficial);
      // os dados começam na coluna B com o ID numérico do produto pai —
      // não o SKU/Referência. "Código da variação (ID)" = 0 em todas as
      // linhas (Tray auto-gera o ID de cada variação nova).
      //
      // IMPORTANTE: a coluna de imagem fica DEPOIS de "peso" (última),
      // nunca no meio. Colocá-la entre "tipo2" e "estoque" (como uma
      // primeira tentativa fez) quebrou a importação — a Tray tratou o
      // upload como se só tivesse 10 colunas (parou de ler exatamente em
      // "Estoque mínimo para aviso" e devolveu erro em toda variação,
      // "Invalid product" incluso). O mapeamento da Tray pra esse
      // template parece ser por POSIÇÃO, não por nome de cabeçalho — só
      // adicionar coluna no fim preserva as posições já validadas.
      const wbOut = new ExcelJS.Workbook();
      const wsOut = wbOut.addWorksheet("Worksheet");
      wsOut.columns = [
        { header: "",                                     key: "blank",       width: 9.17 },
        { header: "Código do produto (ID)",                key: "produtoId",   width: 18 },
        { header: "Código da variação (ID)",                key: "variacaoId",  width: 16 },
        { header: "Nome da variação 1 (exemplo: Moldura)",   key: "nome1",       width: 22 },
        { header: "Nome da variação 2 (exemplo: Tamanho)",   key: "nome2",       width: 18 },
        { header: "Tipo da variação 1 (exemplo: Moldura)",   key: "tipo1",       width: 16 },
        { header: "Tipo da variação 2 (exemplo: Tamanho)",   key: "tipo2",       width: 14 },
        { header: "Estoque da variação",                     key: "estoque",     width: 12 },
        { header: "Estoque mínimo para aviso",               key: "estoqueMin",  width: 16 },
        { header: "Quando acabar o estoque",                 key: "quandoAcabar",width: 20 },
        { header: "Altura (cm)",                             key: "altura",      width: 12 },
        { header: "Comprimento (cm)",                        key: "comprimento", width: 14 },
        { header: "Largura (cm)",                            key: "largura",     width: 12 },
        { header: "Peso da variação (gramas)",               key: "peso",        width: 16 },
        { header: "Preço de venda em reais",                 key: "precoVenda", width: 16 },
        { header: "Preço de custo em reais",                 key: "precoCusto", width: 16 },
        { header: "Endereço da imagem principal da variação",key: "imagem",     width: 60 },
      ];
      wsOut.getRow(1).font = { bold: true };
      wsOut.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
        cell.numFmt = "@";
      });
      for (const key of ["nome1", "nome2", "tipo1", "tipo2", "imagem", "quandoAcabar"]) {
        wsOut.getColumn(key).numFmt = "@";
      }

      for (const { sku, trayId } of pairs) {
        const frameImages = mockupBySku.get(sku);
        for (const moldura of MOLDURAS) {
          const frame = MOLDURA_TO_FRAME[moldura];
          const imagem = toTrayImageUrl(frameImages?.[frame]);
          for (const tam of TAMANHOS) {
            wsOut.addRow({
              produtoId: Math.trunc(trayId),
              variacaoId: 0,
              nome1: moldura,
              nome2: tam.nome,
              tipo1: TIPO_VARIACAO_1,
              tipo2: TIPO_VARIACAO_2,
              imagem,
              estoque: ESTOQUE_POR_VARIACAO,
              estoqueMin: ESTOQUE_MINIMO_AVISO,
              quandoAcabar: QUANDO_ACABAR_ESTOQUE,
              altura: tam.altura,
              comprimento: tam.comprimento,
              largura: tam.largura,
              peso: tam.pesoGramas,
              precoVenda: tam.precoCusto * MARKUP_VENDA,
              precoCusto: tam.precoCusto,
            });
          }
        }
      }

      const out = await wbOut.xlsx.writeBuffer();
      const base64 = Buffer.from(out).toString("base64");
      const fileName = `Tray_Variacoes_${new Date().toISOString().slice(0, 10)}.xlsx`;
      return {
        fileName,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64,
        rows: pairs.length * MOLDURAS.length * TAMANHOS.length,
        products: pairs.length,
        skipped: skippedSkus,
        skusSemMockupPorMoldura,
      };
    }),

  /**
   * Enfileira produtos aprovados para geração de imagens.
   * O worker in-process (catalogWorker) consome a fila em background.
   */
  enqueueGeneration: protectedProcedure
    .input(
      z.object({
        productIds: z.array(z.number().int().positive()).min(1).max(100),
        /**
         * Estilo escolhido manualmente pra essa leva. Se omitido, o pipeline
         * usa o padrão de marca goquadros_signature.
         */
        styleOverride: z.enum(STYLE_TYPES).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      // Apenas produtos do próprio usuário, aprovados ou com erro/idle e
      // que ainda não estejam em processamento.
      await db
        .update(products)
        .set({
          genQueuedAt: new Date(),
          genStartedAt: null,
          genCompletedAt: null,
          genStep: null,
          genError: null,
          genAttempts: 0,
          genStyleOverride: input.styleOverride ?? null,
        })
        .where(
          and(
            eq(products.userId, ctx.user.id),
            inArray(products.id, input.productIds),
          ),
        );
      return { queued: input.productIds.length };
    }),

  /**
   * Remove produtos da fila (se ainda não estão rodando).
   */
  cancelGeneration: protectedProcedure
    .input(
      z.object({
        productIds: z.array(z.number().int().positive()).min(1).max(100),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      await db
        .update(products)
        .set({ genQueuedAt: null })
        .where(
          and(
            eq(products.userId, ctx.user.id),
            inArray(products.id, input.productIds),
            isNull(products.genStartedAt),
          ),
        );
      return { cancelled: input.productIds.length };
    }),

  /**
   * Resumo da fila para a UI exibir progresso global.
   */
  generationStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await db
      .select({
        id: products.id,
        status: products.status,
        genQueuedAt: products.genQueuedAt,
        genStartedAt: products.genStartedAt,
        genCompletedAt: products.genCompletedAt,
        genStep: products.genStep,
        genError: products.genError,
        genAttempts: products.genAttempts,
      })
      .from(products)
      .where(eq(products.userId, ctx.user.id));
    const queued = rows.filter((r) => r.genQueuedAt && !r.genStartedAt && !r.genCompletedAt).length;
    const running = rows.filter((r) => r.genStartedAt && !r.genCompletedAt).length;
    const done = rows.filter((r) => r.status === "generated" || (r.genCompletedAt && !r.genError)).length;
    const errored = rows.filter((r) => r.genError && r.genCompletedAt).length;
    return { queued, running, done, errored, total: rows.length };
  }),

  /**
   * Lista categorias mapeadas (alimenta o select da UI de curadoria).
   */
  listCategories: protectedProcedure.query(async () => {
    const db = await requireDb();
    return db.select().from(categoryCodes).orderBy(categoryCodes.displayName);
  }),
});
