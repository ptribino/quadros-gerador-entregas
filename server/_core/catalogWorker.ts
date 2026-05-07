/**
 * Worker in-process da fila de geração do catálogo.
 *
 * Por que não BullMQ/pg-boss? O Railway desta app não tem Redis e o DB
 * é MySQL — pg-boss é Postgres-only. A fila aqui vive na própria tabela
 * `products`: linhas com `genQueuedAt NOT NULL AND genCompletedAt NULL
 * AND genStartedAt NULL` são "aguardando".
 *
 * Concorrência fixa em 1 (uma geração por vez) — protege quota Gemini
 * e simplifica retry. Cada produto leva ~1.5min (3 chamadas Gemini).
 */
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { products } from "../../drizzle/schema";
import { runForProduct } from "../services/catalogPipeline";
import { getGoogleTokens } from "./oauth";
import { getUserByOpenId } from "../db";
import { eq as eqQ } from "drizzle-orm";

let pool: mysql.Pool | null = null;
let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = false;

const POLL_INTERVAL_MS = 8_000;
const MAX_ATTEMPTS = 3;

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

async function processOne(): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  const db = drizzle(p);

  // Pega a próxima linha aguardando
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

  // Marca como em processamento (corrida resolvida via condição na update)
  const claimRes: any = await p.query(
    `UPDATE products SET genStartedAt = NOW(), genAttempts = genAttempts + 1, status = 'generating'
     WHERE id = ? AND genStartedAt IS NULL`,
    [product.id],
  );
  if (claimRes?.[0]?.affectedRows !== 1) {
    // Outro worker pegou (não deve acontecer com concorrência 1, mas é safe)
    return true;
  }

  console.log(`[catalogWorker] Iniciando produto #${product.id} (${product.sku})`);

  try {
    const openId = await getOpenIdByUserId(p, product.userId);
    if (!openId) throw new Error(`Usuário #${product.userId} não encontrado`);
    const tokens = await getGoogleTokens(openId);
    if (!tokens?.accessToken) throw new Error(`Sem token Google para o usuário ${openId}`);

    const result = await runForProduct(
      {
        id: product.id,
        sku: product.sku,
        nome: product.nome,
        sourceDriveFileId: product.sourceDriveFileId,
      },
      { accessToken: tokens.accessToken },
      async (step, message) => {
        await db
          .update(products)
          .set({ genStep: step })
          .where(eq(products.id, product.id));
        console.log(`[catalogWorker] #${product.id} step ${step}/3: ${message}`);
      },
    );

    await db
      .update(products)
      .set({
        productDriveFolderId: result.productFolderId,
        productDriveFolderUrl: result.productFolderUrl,
        imageUrl1: result.imageUrls[0],
        imageUrl2: result.imageUrls[1],
        imageUrl3: result.imageUrls[2],
        imageUrl4: result.imageUrls[3] ?? null, // referência de tamanhos (se config setada)
        genCompletedAt: new Date(),
        genStep: 3,
        status: "generated",
        generatedAt: new Date(),
        genError: null,
      })
      .where(eq(products.id, product.id));

    console.log(`[catalogWorker] ✓ Produto #${product.id} concluído`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[catalogWorker] ✗ Produto #${product.id} falhou:`, msg);

    const willRetry = (product.genAttempts ?? 0) + 1 < MAX_ATTEMPTS;
    await db
      .update(products)
      .set({
        genError: msg.slice(0, 1000),
        // Se vai tentar de novo: reabrimos o slot (genStartedAt = NULL)
        // Senão: marca como falha definitiva (genCompletedAt + status='error')
        ...(willRetry
          ? { genStartedAt: null }
          : { genCompletedAt: new Date(), status: "error" }),
      })
      .where(eq(products.id, product.id));
    return true;
  }
}

async function tick() {
  if (stopped || running) return;
  running = true;
  try {
    // Drena a fila enquanto houver trabalho disponível
    let didWork = true;
    while (didWork && !stopped) {
      didWork = await processOne();
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
  // Roda uma vez no boot pra retomar jobs deixados em "queued" antes do restart
  void tick();
}

export function stopCatalogWorker() {
  stopped = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
