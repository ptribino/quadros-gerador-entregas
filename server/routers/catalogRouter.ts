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
        status: z.enum(["approved", "rejected"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const setClause: Record<string, unknown> = { status: input.status };
      if (input.status === "approved") setClause.approvedAt = new Date();

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

      // Layout EXATO do template oficial de importação da Tray (30 colunas).
      // Colunas 1 e 2 ("Código do produto (ID)" e "Código da categoria
      // principal (ID)") são numéricas — deixadas em branco para criar
      // produtos novos (Tray gera os IDs); preencher só ao atualizar.

      // Transforma URLs antigas salvas no DB (formato `uc?export=download&id=...`)
      // em URLs do proxy `/img/<id>.jpg` que a Tray aceita. Sem isso, produtos
      // gerados antes desse fix continuam quebrando na importação.
      const toTrayImageUrl = (saved: string | null | undefined): string => {
        if (!saved) return "";
        return googleDriveService.publicDownloadUrl(extractDriveFileId(saved));
      };

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Worksheet");
      ws.columns = [
        { header: "Código do produto (ID)", key: "id", width: 14 },                       // 1
        { header: "Código da categoria principal (ID)", key: "catId", width: 18 },        // 2
        { header: "Nome do produto", key: "nome", width: 60 },                            // 3
        { header: "HTML da descrição completa", key: "html", width: 80 },                 // 4
        { header: "Endereço da imagem principal do produto", key: "img1", width: 50 },    // 5
        { header: "Endereço da imagem do produto 2", key: "img2", width: 50 },            // 6
        { header: "Endereço da imagem do produto 3", key: "img3", width: 50 },            // 7
        { header: "Endereço da imagem do produto 4", key: "img4", width: 50 },            // 8
        { header: "Preço de venda em reais", key: "precoVenda", width: 16 },              // 9
        { header: "Peso do produto (gramas)", key: "peso", width: 14 },                   // 10
        { header: "Estoque do produto", key: "estoque", width: 12 },                      // 11
        { header: "Estoque mínimo para aviso", key: "estoqueMin", width: 12 },            // 12
        { header: "Exibir selo destaque na loja", key: "seloDestaque", width: 14 },       // 13
        { header: "Exibir selo de lançamento", key: "seloLancamento", width: 14 },        // 14
        { header: "Exibir selo adicional", key: "seloAdicional", width: 14 },             // 15
        { header: "Marca", key: "marca", width: 16 },                                     // 16
        { header: "Modelo", key: "modelo", width: 30 },                                   // 17
        { header: "Referência (código fornecedor)", key: "sku", width: 60 },              // 18
        { header: "Tempo de garantia", key: "garantia", width: 14 },                      // 19
        { header: "Preço de custo em reais", key: "precoCusto", width: 16 },              // 20
        { header: "Comprimento (cm)", key: "comprimento", width: 14 },                    // 21
        { header: "Largura (cm)", key: "largura", width: 10 },                            // 22
        { header: "Altura (cm)", key: "altura", width: 10 },                              // 23
        { header: "SEO - Titulo do produto", key: "seoTitulo", width: 40 },               // 24
        { header: "SEO - Descrição simplificada", key: "seoDesc", width: 50 },            // 25
        { header: "SEO - Palavras chaves do produto", key: "seoKeywords", width: 40 },    // 26
        { header: "SEO - Endereço do produto (URL)", key: "slug", width: 50 },            // 27
        { header: "Nome da categoria - nível 1", key: "catN1", width: 22 },               // 28
        { header: "Nome da categoria - nível 2", key: "catN2", width: 22 },               // 29
        { header: "Exibir na loja", key: "naLoja", width: 12 },                           // 30
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
          // Ordem (pipeline novo):
          //   1 = arte original web-fit (sem moldura/ambiente)
          //   2 = lifestyle 1
          //   3 = lifestyle 2
          //   4 = mockup
          // Produtos gerados ANTES dessa mudança têm ordem antiga
          // (1 = lifestyle, 4 = referência de tamanhos) — precisam ser
          // re-gerados pra ficarem no formato novo.
          img1: toTrayImageUrl(p.imageUrl1),
          img2: toTrayImageUrl(p.imageUrl2),
          img3: toTrayImageUrl(p.imageUrl3),
          img4: toTrayImageUrl(p.imageUrl4),
          precoVenda: Number(p.precoVenda),
          peso: p.pesoGramas,
          estoque: p.estoque,
          estoqueMin: 5,
          seloDestaque: 0,
          seloLancamento: 0,
          seloAdicional: 0,
          marca: p.marca,
          modelo: p.modelo ?? p.sku,
          sku: p.sku,
          garantia: p.tempoGarantia,
          precoCusto: Number(p.precoCusto),
          comprimento: Number(p.comprimentoCm),
          largura: Number(p.larguraCm),
          altura: Number(p.alturaCm),
          seoTitulo: p.nome,
          seoDesc,
          seoKeywords: p.aiPalavrasChave ?? "",
          slug: p.slugSeo ?? "",
          catN1: c?.trayCategoriaPrincipal ?? "Temas",
          catN2: c?.traySubcategoria ?? "",
          naLoja: p.exibirNaLoja ? "Sim" : "Não",
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
      };
    }),

  /**
   * Gera planilha de variações Tray a partir do XLSX de produtos exportado
   * pela Tray (com a coluna "Código do produto (ID)" preenchida).
   *
   * Fluxo (round-trip):
   *  1. Usuária importa produtos via `exportTrayImport` → Tray atribui IDs.
   *  2. Usuária baixa do painel da Tray a planilha de produtos com os IDs.
   *  3. Aqui: lemos esse XLSX, casamos SKU (coluna "Referência") → ID Tray,
   *     e emitimos 32 linhas por produto (4 molduras × 8 tamanhos) no
   *     layout do template oficial de variações da Tray (14 colunas: uma
   *     coluna A vazia, depois Código do produto, Código da variação,
   *     Nome 1, Nome 2, Tipo 1, Tipo 2, Estoque, Estoque mínimo, Quando
   *     acabar, Altura, Comprimento, Largura, Peso).
   */
  exportTrayVariations: protectedProcedure
    .input(z.object({ fileBase64: z.string().min(1) }))
    .mutation(async ({ input }) => {
      // Matrix fixo: 4 molduras × 8 tamanhos = 32 variações por produto.
      // Altura constante 9cm; largura e comprimento da embalagem crescem
      // com o tamanho do quadro (tabela operacional da Qtok Quadros).
      const MOLDURAS = [
        "Amadeirado claro",
        "Amadeirado escuro",
        "Branca",
        "Preta",
      ] as const;
      type SizeRow = {
        nome: string;
        altura: number;
        largura: number;
        comprimento: number;
        pesoGramas: number;
      };
      const TAMANHOS: SizeRow[] = [
        { nome: "60cm x 40cm",   altura: 9, largura: 45,  comprimento: 65,  pesoGramas: 1500 },
        { nome: "70cm x 50cm",   altura: 9, largura: 55,  comprimento: 75,  pesoGramas: 2000 },
        { nome: "80cm x 55cm",   altura: 9, largura: 60,  comprimento: 85,  pesoGramas: 2500 },
        { nome: "90cm x 60cm",   altura: 9, largura: 65,  comprimento: 95,  pesoGramas: 3000 },
        { nome: "100cm x 70cm",  altura: 9, largura: 75,  comprimento: 105, pesoGramas: 3500 },
        { nome: "120cm x 80cm",  altura: 9, largura: 85,  comprimento: 125, pesoGramas: 4500 },
        { nome: "150cm x 100cm", altura: 9, largura: 105, comprimento: 155, pesoGramas: 6000 },
        { nome: "160cm x 110cm", altura: 9, largura: 115, comprimento: 165, pesoGramas: 7000 },
      ];
      const ESTOQUE_POR_VARIACAO = 99;
      const ESTOQUE_MIN = 0;

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
        const headerRow = ws.getRow(1);
        let idCol = -1;
        let refCol = -1;
        headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const text = String(cell.value ?? "");
          if (isIdHeader(text)) idCol = colNumber;
          if (isRefHeader(text)) refCol = colNumber;
        });
        if (idCol === -1 || refCol === -1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Não achei as colunas 'Código produto' e 'Referência' no cabeçalho. Confirme que é a planilha de produtos exportada pela Tray.",
          });
        }
        for (let r = 2; r <= ws.rowCount; r++) {
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
        const header = rows[0];
        const idCol = header.findIndex(isIdHeader);
        const refCol = header.findIndex(isRefHeader);
        if (idCol === -1 || refCol === -1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Não achei as colunas 'Código produto' e 'Referência' no cabeçalho. Confirme que é a planilha de produtos exportada pela Tray.",
          });
        }
        for (let r = 1; r < rows.length; r++) {
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

      // Layout oficial: a coluna A é vazia no template da Tray — preservada
      // por compatibilidade.
      const wbOut = new ExcelJS.Workbook();
      const wsOut = wbOut.addWorksheet("Worksheet");
      wsOut.columns = [
        { header: "",                                       key: "_pad",        width: 4 },
        { header: "Código do produto (ID)",                 key: "produtoId",   width: 16 },
        { header: "Código da variação (ID)",                key: "variacaoId",  width: 16 },
        { header: "Nome da variação 1 (exemplo: Branco)",   key: "nome1",       width: 22 },
        { header: "Nome da variação 2 (exemplo: GG)",       key: "nome2",       width: 18 },
        { header: "Tipo da variação 1 (exemplo: Cor)",      key: "tipo1",       width: 16 },
        { header: "Tipo da variação 2 (exemplo: Tamanho)",  key: "tipo2",       width: 14 },
        { header: "Estoque da variação",                    key: "estoque",     width: 12 },
        { header: "Estoque mínimo para aviso",              key: "estoqueMin",  width: 14 },
        { header: "Quando acabar o estoque",                key: "fimEstoque",  width: 16 },
        { header: "Altura (cm)",                            key: "altura",      width: 12 },
        { header: "Comprimento (cm)",                       key: "comprimento", width: 14 },
        { header: "Largura (cm)",                           key: "largura",     width: 12 },
        { header: "Peso da variação (gramas)",              key: "peso",        width: 16 },
      ];
      wsOut.getRow(1).font = { bold: true };

      for (const { trayId } of pairs) {
        for (const moldura of MOLDURAS) {
          for (const tam of TAMANHOS) {
            wsOut.addRow({
              _pad: null,
              produtoId: trayId,
              variacaoId: null,
              nome1: moldura,
              nome2: tam.nome,
              tipo1: "Cor Moldura",
              tipo2: "Tamanho",
              estoque: ESTOQUE_POR_VARIACAO,
              estoqueMin: ESTOQUE_MIN,
              fimEstoque: null,
              altura: tam.altura,
              comprimento: tam.comprimento,
              largura: tam.largura,
              peso: tam.pesoGramas,
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
