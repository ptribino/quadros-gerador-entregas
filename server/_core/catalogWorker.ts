/**
 * Worker in-process da fila de geração do catálogo — via Gemini Batch API
 * (50% mais barato que a chamada síncrona generateContent usada antes,
 * mesmo modelo gemini-3.1-flash-image; ver server/services/freepikService.ts).
 *
 * Por que não BullMQ/pg-boss? O Railway desta app não tem Redis e o DB é
 * MySQL — pg-boss é Postgres-only. A fila vive na própria tabela `products`
 * (genQueuedAt/genStartedAt/genCompletedAt, igual antes) + na tabela nova
 * `product_gen_tasks` (uma linha por chamada de imagem Gemini).
 *
 * Cada produto atravessa 3 fases assíncronas, tocadas por 3 ticks
 * encadeados a cada rodada (concorrência 1, mesmo padrão de antes):
 *
 *   1. Enqueuer  — reivindica 1 produto aguardando, roda a Etapa 0 (Drive:
 *                  pasta + upload da arte original) e cria as 3 tasks da
 *                  fase A (lifestyle-regular, lifestyle-pro, mockup-base).
 *   2. Submitter — agrupa tasks 'pending' em lotes (~15MB, sob o limite
 *                  inline de 20MB da Batch API) e submete via
 *                  googleImagenService.submitBatch.
 *   3. Poller    — consulta o status dos lotes 'submitted'; ao suceder,
 *                  salva o resultado de cada task; quando as 3 tasks da
 *                  fase A terminam, dispara a fase B (3 recolors de
 *                  moldura); quando as 3 da fase B terminam, roda a
 *                  montagem final (upload + URLs) e conclui o produto.
 *
 * Falha de uma task: retry só daquela task (attempts, MAX_TASK_ATTEMPTS) —
 * não refaz as outras já concluídas. Só quando uma task esgota suas
 * tentativas o produto inteiro é marcado como erro (mesmo contrato de
 * sempre: genError + genCompletedAt + status='error'; só um novo
 * enqueueGeneration pela UI reabre).
 *
 * O fluxo manual "Gerar variações" (server/routers/generationRouter.ts)
 * não passa por aqui — continua síncrono via googleImagenService.generateImages.
 */
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { products, productGenTasks } from "../../drizzle/schema";
import type { ProductGenTask } from "../../drizzle/schema";
import {
  prepareProduct,
  buildPhaseBTasks,
  assembleProduct,
} from "../services/catalogPipeline";
import type { PipelineProduct, GenParams, GenTaskResult, FrameType } from "../services/catalogPipeline";
import { googleImagenService } from "../services/freepikService";
import { getValidAccessToken } from "./oauth";

function makeDb(p: mysql.Pool) {
  return drizzle(p);
}
type Db = ReturnType<typeof makeDb>;

let pool: mysql.Pool | null = null;
let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = false;

const POLL_INTERVAL_MS = 8_000;
const MAX_ATTEMPTS = 3; // tentativas de reivindicar o produto (Enqueuer)
const MAX_TASK_ATTEMPTS = 3; // tentativas de UMA task de geração dentro do lote
const MAX_BATCH_PAYLOAD_BYTES = 15 * 1024 * 1024; // margem sob o limite inline de 20MB da Batch API

function getPool(): mysql.Pool | null {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) return null;
  pool = mysql.createPool(process.env.DATABASE_URL);
  return pool;
}

/**
 * Pega o openId do user dono do produto.
 * Drizzle não tem o relation table mapeado, então faço query crua.
 */
async function getOpenIdByUserId(p: mysql.Pool, userId: number): Promise<string | null> {
  const [rows]: any = await p.query("SELECT openId FROM users WHERE id = ? LIMIT 1", [userId]);
  return rows?.[0]?.openId ?? null;
}

async function getCategoryCode3(p: mysql.Pool, categoryCodeId: number | null): Promise<string | null> {
  if (!categoryCodeId) return null;
  const [rows]: any = await p.query(
    "SELECT code3 FROM category_codes WHERE id = ? LIMIT 1",
    [categoryCodeId],
  );
  return rows?.[0]?.code3 ?? null;
}

async function getAccessTokenForUser(p: mysql.Pool, userId: number): Promise<string> {
  const openId = await getOpenIdByUserId(p, userId);
  if (!openId) throw new Error(`Usuário #${userId} não encontrado`);
  const accessToken = await getValidAccessToken(openId);
  if (!accessToken) throw new Error(`Sem token Google para o usuário ${openId}`);
  return accessToken;
}

// ============================================================
// 1. Enqueuer — reivindica 1 produto e cria as 3 tasks da fase A
// ============================================================

async function enqueueTick(db: Db, p: mysql.Pool): Promise<boolean> {
  const candidates = await db
    .select()
    .from(products)
    .where(
      and(
        isNotNull(products.genQueuedAt),
        isNull(products.genStartedAt),
        isNull(products.genCompletedAt),
      ),
    )
    .orderBy(asc(products.genQueuedAt))
    .limit(1);

  if (candidates.length === 0) return false;
  const product = candidates[0];

  const claimRes: any = await p.query(
    `UPDATE products SET genStartedAt = NOW(), genAttempts = genAttempts + 1, status = 'generating'
     WHERE id = ? AND genStartedAt IS NULL`,
    [product.id],
  );
  if (claimRes?.[0]?.affectedRows !== 1) {
    // Outro worker pegou (não deve acontecer com concorrência 1, mas é safe)
    return true;
  }

  console.log(`[catalogWorker] Iniciando produto #${product.id} (${product.sku}) — Etapa 0 + fase A`);

  try {
    const accessToken = await getAccessTokenForUser(p, product.userId);
    const categoryCode3 = await getCategoryCode3(p, product.categoryCodeId);

    const prepared = await prepareProduct(
      {
        id: product.id,
        sku: product.sku,
        nome: product.nome,
        sourceDriveFileId: product.sourceDriveFileId,
        categoryCode3,
        aiPalavrasChave: product.aiPalavrasChave,
        styleOverride: product.genStyleOverride as PipelineProduct["styleOverride"],
      },
      { accessToken },
    );

    await db
      .update(products)
      .set({
        productDriveFolderId: prepared.productFolderId,
        productDriveFolderUrl: prepared.productFolderUrl,
        genParams: prepared.genParams,
        genPhase: "a",
      })
      .where(eq(products.id, product.id));

    // Uma linha por INSERT, não um multi-row insert — cada referenceImageB64
    // já vem comprimido (≤1MB binário, ~1.4MB em base64; ver prepareProduct),
    // mas 3 delas somadas num único INSERT ainda beiravam o max_allowed_packet
    // do MySQL (default histórico de 4MB) e derrubavam as 3 tasks de uma vez.
    // Uma linha por vez fica bem abaixo de qualquer limite razoável.
    for (const spec of prepared.phaseATasks) {
      await db.insert(productGenTasks).values({
        productId: product.id,
        phase: "a" as const,
        kind: spec.kind,
        frameColor: spec.frameColor,
        prompt: spec.prompt,
        referenceImageB64: spec.referenceImageB64,
        referenceMimeType: spec.referenceMimeType,
        aspectRatio: spec.aspectRatio,
      });
    }

    console.log(`[catalogWorker] #${product.id} — fase A criada (3 tasks)`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[catalogWorker] ✗ Produto #${product.id} falhou na Etapa 0:`, msg);

    const willRetry = (product.genAttempts ?? 0) + 1 < MAX_ATTEMPTS;
    await db
      .update(products)
      .set({
        genError: msg.slice(0, 1000),
        ...(willRetry
          ? { genStartedAt: null }
          : { genCompletedAt: new Date(), status: "error" }),
      })
      .where(eq(products.id, product.id));
    return true;
  }
}

// ============================================================
// 2. Submitter — agrupa tasks 'pending' em lotes e submete ao Gemini
// ============================================================

async function submitTick(db: Db): Promise<boolean> {
  const pending = await db
    .select()
    .from(productGenTasks)
    .where(eq(productGenTasks.status, "pending"))
    .orderBy(asc(productGenTasks.createdAt));

  if (pending.length === 0) return false;

  let didWork = false;
  let chunk: ProductGenTask[] = [];
  let chunkBytes = 0;

  const flush = async () => {
    if (chunk.length === 0) return;
    const current = chunk;
    chunk = [];
    chunkBytes = 0;

    const displayName = `catalog-${Date.now()}`;
    try {
      const { batchName } = await googleImagenService.submitBatch(
        current.map((t) => ({
          key: `task-${t.id}`,
          prompt: t.prompt,
          referenceImageB64: t.referenceImageB64,
          referenceMimeType: t.referenceMimeType,
          aspectRatio: t.aspectRatio as "3:4" | "4:3",
        })),
        displayName,
      );

      await db
        .update(productGenTasks)
        .set({
          status: "submitted",
          batchName,
          batchRequestKey: sql`concat('task-', ${productGenTasks.id})`,
        })
        .where(inArray(productGenTasks.id, current.map((t) => t.id)));

      console.log(`[catalogWorker] Submetido lote ${batchName} com ${current.length} task(s)`);
      didWork = true;
    } catch (err) {
      console.error(`[catalogWorker] Falha ao submeter lote (${current.length} tasks) — tenta de novo no próximo tick:`, err);
    }
  };

  for (const task of pending) {
    const taskBytes = task.referenceImageB64.length;
    if (chunk.length > 0 && chunkBytes + taskBytes > MAX_BATCH_PAYLOAD_BYTES) {
      await flush();
    }
    chunk.push(task);
    chunkBytes += taskBytes;
  }
  await flush();

  return didWork;
}

// ============================================================
// 3. Poller — consulta status dos lotes, salva resultados, avança fases
// ============================================================

async function handleTaskFailure(
  db: Db,
  task: ProductGenTask,
  message: string,
): Promise<void> {
  const attempts = task.attempts + 1;
  if (attempts < MAX_TASK_ATTEMPTS) {
    await db
      .update(productGenTasks)
      .set({ status: "pending", attempts, error: message.slice(0, 1000), batchName: null, batchRequestKey: null })
      .where(eq(productGenTasks.id, task.id));
    return;
  }

  // Esgotou as tentativas dessa task específica — aborta o produto inteiro
  // (mesmo contrato terminal de sempre: só um novo enqueueGeneration reabre).
  console.error(`[catalogWorker] ✗ Produto #${task.productId} falhou definitivamente (${task.kind}): ${message}`);
  await db
    .update(products)
    .set({
      genError: message.slice(0, 1000),
      genCompletedAt: new Date(),
      status: "error",
    })
    .where(eq(products.id, task.productId));
  await db.delete(productGenTasks).where(eq(productGenTasks.productId, task.productId));
}

/** Depois que um lote de tasks é atualizado, checa se o produto pode avançar de fase ou finalizar. */
async function advanceProductIfReady(db: Db, p: mysql.Pool, productId: number): Promise<void> {
  const productRows = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  const product = productRows[0];
  if (!product || !product.genPhase) return; // já finalizado/falhou nesse meio tempo

  const tasks = await db.select().from(productGenTasks).where(eq(productGenTasks.productId, productId));
  const genParams = product.genParams as GenParams | null;

  if (product.genPhase === "a") {
    const phaseA = tasks.filter((t) => t.phase === "a");
    if (phaseA.length < 3 || !phaseA.every((t) => t.status === "succeeded")) return;
    if (!genParams) {
      console.error(`[catalogWorker] Produto #${productId} sem genParams na transição fase A→B`);
      return;
    }

    const mockupBase = phaseA.find((t) => t.kind === "mockup_base");
    if (!mockupBase?.resultB64 || !mockupBase.resultMimeType) {
      console.error(`[catalogWorker] Produto #${productId} sem resultado de mockup_base na transição fase A→B`);
      return;
    }

    const phaseBSpecs = buildPhaseBTasks(genParams, mockupBase.resultB64, mockupBase.resultMimeType);
    // Uma linha por INSERT — mesmo motivo da fase A (ver comentário lá):
    // evita somar 3 cópias de referenceImageB64 num único multi-row insert
    // e estourar o max_allowed_packet do MySQL.
    for (const spec of phaseBSpecs) {
      await db.insert(productGenTasks).values({
        productId,
        phase: "b" as const,
        kind: spec.kind,
        frameColor: spec.frameColor,
        prompt: spec.prompt,
        referenceImageB64: spec.referenceImageB64,
        referenceMimeType: spec.referenceMimeType,
        aspectRatio: spec.aspectRatio,
      });
    }
    await db.update(products).set({ genPhase: "b" }).where(eq(products.id, productId));
    console.log(`[catalogWorker] #${productId} — fase A concluída, iniciando fase B (recolors)`);
    return;
  }

  if (product.genPhase === "b") {
    const phaseB = tasks.filter((t) => t.phase === "b");
    if (phaseB.length < 3 || !phaseB.every((t) => t.status === "succeeded")) return;
    if (!genParams) {
      console.error(`[catalogWorker] Produto #${productId} sem genParams na montagem final`);
      return;
    }

    const results: GenTaskResult[] = tasks
      .filter((t) => t.resultB64 && t.resultMimeType)
      .map((t) => ({
        kind: t.kind,
        frameColor: (t.frameColor as FrameType | null) ?? undefined,
        b64Data: t.resultB64!,
        mimeType: t.resultMimeType!,
      }));

    try {
      const accessToken = await getAccessTokenForUser(p, product.userId);
      const pipelineProduct: PipelineProduct = {
        id: product.id,
        sku: product.sku,
        nome: product.nome,
        sourceDriveFileId: product.sourceDriveFileId,
      };
      const result = await assembleProduct(pipelineProduct, { accessToken }, genParams, results);

      await db
        .update(products)
        .set({
          productDriveFolderId: result.productFolderId,
          productDriveFolderUrl: result.productFolderUrl,
          imageUrl1: result.imageUrls[0],
          imageUrl2: result.imageUrls[1],
          imageUrl3: result.imageUrls[2],
          imageUrl4: result.imageUrls[3] ?? null,
          mockupUrlLightWood: result.mockupUrls.light_wood ?? null,
          mockupUrlDarkWood: result.mockupUrls.dark_wood ?? null,
          mockupUrlWhite: result.mockupUrls.white ?? null,
          mockupUrlBlack: result.mockupUrls.black ?? null,
          genCompletedAt: new Date(),
          genStep: 3,
          genPhase: null,
          genParams: null,
          status: "generated",
          generatedAt: new Date(),
          genError: null,
        })
        .where(eq(products.id, productId));

      await db.delete(productGenTasks).where(eq(productGenTasks.productId, productId));
      console.log(`[catalogWorker] ✓ Produto #${productId} concluído (montagem final)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[catalogWorker] ✗ Produto #${productId} falhou na montagem final:`, msg);
      await db
        .update(products)
        .set({ genError: msg.slice(0, 1000), genCompletedAt: new Date(), status: "error" })
        .where(eq(products.id, productId));
      await db.delete(productGenTasks).where(eq(productGenTasks.productId, productId));
    }
  }
}

async function pollTick(db: Db, p: mysql.Pool): Promise<boolean> {
  const submittedBatches = await db
    .selectDistinct({ batchName: productGenTasks.batchName })
    .from(productGenTasks)
    .where(and(eq(productGenTasks.status, "submitted"), isNotNull(productGenTasks.batchName)));

  if (submittedBatches.length === 0) return false;

  const touchedProductIds = new Set<number>();
  let didWork = false;

  for (const { batchName } of submittedBatches) {
    if (!batchName) continue;

    let status;
    try {
      status = await googleImagenService.getBatch(batchName);
    } catch (err) {
      console.error(`[catalogWorker] Falha ao consultar batch ${batchName} — tenta de novo no próximo tick:`, err);
      continue;
    }

    if (status.state === "BATCH_STATE_PENDING" || status.state === "BATCH_STATE_RUNNING") {
      continue;
    }
    didWork = true;

    const tasksInBatch = await db.select().from(productGenTasks).where(eq(productGenTasks.batchName, batchName));
    const failedProductIds = new Set<number>();

    if (status.state === "BATCH_STATE_SUCCEEDED" && status.results) {
      const resultsByKey = new Map(status.results.map((r) => [r.key, r]));
      for (const task of tasksInBatch) {
        if (failedProductIds.has(task.productId)) continue; // produto já abortado nesta rodada
        touchedProductIds.add(task.productId);
        const result = task.batchRequestKey ? resultsByKey.get(task.batchRequestKey) : undefined;

        if (result?.b64Data) {
          await db
            .update(productGenTasks)
            .set({ status: "succeeded", resultB64: result.b64Data, resultMimeType: result.mimeType ?? "image/jpeg" })
            .where(eq(productGenTasks.id, task.id));
        } else {
          await handleTaskFailure(db, task, result?.error ?? "Nenhuma imagem retornada para essa request");
          failedProductIds.add(task.productId);
        }
      }
    } else {
      // FAILED / CANCELLED / EXPIRED no nível do job inteiro
      for (const task of tasksInBatch) {
        if (failedProductIds.has(task.productId)) continue;
        touchedProductIds.add(task.productId);
        await handleTaskFailure(db, task, `Batch ${status.state}`);
        failedProductIds.add(task.productId);
      }
    }
  }

  for (const productId of Array.from(touchedProductIds)) {
    await advanceProductIfReady(db, p, productId);
  }

  return didWork;
}

// ============================================================
// Orquestração
// ============================================================

async function tick() {
  if (stopped || running) return;
  running = true;
  try {
    const p = getPool();
    if (!p) return;
    const db = makeDb(p);

    // Drena o trabalho disponível nas 3 fases a cada rodada
    let didWork = true;
    while (didWork && !stopped) {
      const didEnqueue = await enqueueTick(db, p);
      const didSubmit = await submitTick(db);
      const didPoll = await pollTick(db, p);
      didWork = didEnqueue || didSubmit || didPoll;
    }
  } catch (err) {
    console.error("[catalogWorker] tick error:", err);
  } finally {
    running = false;
  }
}

export function startCatalogWorker() {
  if (timer) return;
  console.log("[catalogWorker] iniciado (poll a cada", POLL_INTERVAL_MS, "ms)");
  timer = setInterval(tick, POLL_INTERVAL_MS);
  // Roda uma vez no boot pra retomar jobs deixados em andamento antes do restart
  void tick();
}

export function stopCatalogWorker() {
  stopped = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
