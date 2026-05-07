import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { protectedProcedure, router } from "../_core/trpc";
import { getGoogleTokens } from "../_core/oauth";
import { googleDriveService } from "../services/googleDriveService";
import { analyzeImageForCatalog, buildSku, buildSlug } from "../services/catalogService";
import { getDb } from "../db";
import { categoryCodes, products, productStatusEnum } from "../../drizzle/schema";
import { ENV } from "../_core/env";

async function requireAccessToken(openId: string): Promise<string> {
  const tokens = await getGoogleTokens(openId);
  if (!tokens?.accessToken) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Faça login com Google para acessar o Drive",
    });
  }
  return tokens.accessToken;
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
   * Lista categorias mapeadas (alimenta o select da UI de curadoria).
   */
  listCategories: protectedProcedure.query(async () => {
    const db = await requireDb();
    return db.select().from(categoryCodes).orderBy(categoryCodes.displayName);
  }),
});
