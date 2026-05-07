/**
 * Aplica migrations Drizzle e seed idempotente das categorias no boot.
 * Executa de forma idempotente — drizzle rastreia quais migrations
 * já foram aplicadas na tabela `__drizzle_migrations`.
 *
 * Em dev/prod o servidor chama isto antes de aceitar tráfego.
 * Falhas aqui NÃO derrubam o servidor: log de warning e segue.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { sql } from "drizzle-orm";

const SEEDS = [
  ["#AB Artes Abstratas",     "Artes Abstratas",     "ABS", "Quadros Decorativos", "Abstratos"],
  ["#AC Arte Clássica",       "Arte Clássica",       "ACL", "Quadros Decorativos", "Clássicos"],
  ["#AI Alcohol Ink",         "Alcohol Ink",         "AIK", "Quadros Decorativos", "Abstratos"],
  ["#AN Vida Animal",         "Vida Animal",         "ANI", "Quadros Decorativos", "Animais"],
  ["#BD Bebidas e Drinks",    "Bebidas e Drinks",    "BBD", "Quadros Decorativos", "Gastronomia"],
  ["#ES Esculturas Hipsters", "Esculturas Hipsters", "ESC", "Quadros Decorativos", "Esculturas"],
  ["#FG Formas Geométricas",  "Formas Geométricas",  "FGE", "Quadros Decorativos", "Geométricos"],
  ["#FP Flores e Plantas",    "Flores e Plantas",    "FLO", "Quadros Decorativos", "Florais"],
  ["#FR Frases e Citações",   "Frases e Citações",   "FRA", "Quadros Decorativos", "Frases"],
  ["#GP Galaxias e Planetas", "Galáxias e Planetas", "GLX", "Quadros Decorativos", "Espaço"],
  ["#IN Tema Infantil",       "Tema Infantil",       "INF", "Quadros Decorativos", "Infantil"],
  ["#MF Mulheres Floridas",   "Mulheres Floridas",   "MUF", "Quadros Decorativos", "Femininos"],
  ["#PN Paisagens Naturais",  "Paisagens Naturais",  "PAI", "Quadros Decorativos", "Paisagens"],
  ["#PO Pinturas a Óleo",     "Pinturas a Óleo",     "POL", "Quadros Decorativos", "Pinturas"],
  ["#TD Trios Diversos",      "Trios Diversos",      "TRD", "Quadros Decorativos", "Trios"],
  ["#VD Veículos Diversos",   "Veículos Diversos",   "VEI", "Quadros Decorativos", "Veículos"],
  ["#WR Wine and Red",        "Wine and Red",        "WIN", "Quadros Decorativos", "Vinhos"],
] as const;

export async function runStartupMigrations() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[startupMigrate] DATABASE_URL não setada — pulando migrations.");
    return;
  }

  // Caminho da pasta `drizzle/` relativo ao bundle/source.
  // Em dev: server/_core/startupMigrate.ts -> ../../drizzle
  // Em prod (esbuild bundle em dist/index.js): dist/index.js -> ../drizzle
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(__dirname, "..", "..", "drizzle"),
    path.join(__dirname, "..", "drizzle"),
    path.join(process.cwd(), "drizzle"),
  ];
  const fs = await import("node:fs");
  const migrationsFolder = candidates.find((p) =>
    fs.existsSync(path.join(p, "meta", "_journal.json")),
  );
  if (!migrationsFolder) {
    console.warn(
      "[startupMigrate] Pasta drizzle/ não encontrada nos caminhos candidatos:",
      candidates,
    );
    return;
  }

  let pool: mysql.Pool | null = null;
  try {
    // createPool aceita o formato de URL que drizzle usa internamente
    // (createConnection é mais restrito quanto ao formato da URL).
    pool = mysql.createPool(url);
    const db = drizzle(pool);

    console.log("[startupMigrate] Aplicando migrations de", migrationsFolder);
    try {
      await migrate(db, { migrationsFolder });
      console.log("[startupMigrate] Migrations Drizzle OK");
    } catch (migrateErr) {
      // Falha comum: migrations 0000/0001 foram aplicadas fora do controle
      // do drizzle (ex: db:push antigo). Aí o migrate tenta tudo de novo e
      // bate em "Table already exists". Logamos e seguimos pro fallback DDL.
      const msg = migrateErr instanceof Error ? migrateErr.message : String(migrateErr);
      console.warn("[startupMigrate] migrate() falhou — tentando fallback DDL idempotente.");
      console.warn("[startupMigrate] motivo:", msg);
    }

    // Fallback DDL idempotente — garante o schema necessário pro catálogo
    // mesmo que `migrate()` não tenha rodado por causa de drift histórico.
    await ensureSchema(pool);

    // Seed idempotente das categorias
    let inserted = 0;
    for (const [folderName, displayName, code3, principal, sub] of SEEDS) {
      const result: any = await db.execute(
        sql`INSERT INTO category_codes
            (folderName, displayName, code3, trayCategoriaPrincipal, traySubcategoria)
            VALUES (${folderName}, ${displayName}, ${code3}, ${principal}, ${sub})
            ON DUPLICATE KEY UPDATE
              displayName = VALUES(displayName),
              trayCategoriaPrincipal = VALUES(trayCategoriaPrincipal),
              traySubcategoria = VALUES(traySubcategoria)`,
      );
      if (result?.[0]?.affectedRows === 1) inserted += 1;
    }
    console.log(
      `[startupMigrate] Seed categorias OK (${inserted} novas, ${SEEDS.length - inserted} já existiam)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack : "";
    const dump = JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}));
    console.error("[startupMigrate] Falha (não fatal — servidor continua)");
    console.error("[startupMigrate] erro:", msg || "(sem mensagem)");
    console.error("[startupMigrate] dump:", dump);
    if (stack) console.error("[startupMigrate] stack:", stack);
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

/**
 * Garante que as colunas/tabelas necessárias existem.
 * Usa pool.query() raw (NÃO drizzle.execute) porque MySQL não aceita
 * DDL via prepared statement — drizzle.execute prepara a query e
 * o erro vinha vazio, dificultando o diagnóstico.
 */
async function ensureSchema(pool: mysql.Pool) {
  // 1. Coluna googleTokenExpiresAt em users (parte da migration 0002)
  try {
    await pool.query(
      "ALTER TABLE users ADD COLUMN googleTokenExpiresAt timestamp NULL",
    );
    console.log("[startupMigrate] DDL: users.googleTokenExpiresAt criada");
  } catch (err: any) {
    // 1060 = duplicate column (já existe). Qualquer outro erro é re-logado.
    if (err?.errno !== 1060) {
      console.warn(
        "[startupMigrate] DDL users alter falhou:",
        err?.message || err,
        "errno:",
        err?.errno,
      );
    }
  }

  // 2. Tabela category_codes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS category_codes (
      id int AUTO_INCREMENT NOT NULL,
      folderName varchar(255) NOT NULL,
      displayName varchar(255) NOT NULL,
      code3 varchar(3) NOT NULL,
      trayCategoriaPrincipal varchar(255) NOT NULL,
      traySubcategoria varchar(255),
      traySubsubcategoria varchar(255),
      driveFolderId varchar(128),
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY category_codes_folderName_idx (folderName),
      UNIQUE KEY category_codes_code3_idx (code3)
    )
  `);

  // 3. Tabela products
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id int AUTO_INCREMENT NOT NULL,
      userId int NOT NULL,
      categoryCodeId int,
      sku varchar(128) NOT NULL,
      nome varchar(255) NOT NULL,
      descricaoHtml text,
      slugSeo varchar(255),
      precoVenda decimal(10,2) NOT NULL DEFAULT '199.90',
      precoCusto decimal(10,2) NOT NULL DEFAULT '89.90',
      estoque int NOT NULL DEFAULT 99,
      ncm varchar(20) NOT NULL DEFAULT '4911.99.90',
      prazoDisponibilidade int NOT NULL DEFAULT 7,
      pesoGramas int NOT NULL DEFAULT 1200,
      larguraCm decimal(6,2) NOT NULL DEFAULT '62.00',
      alturaCm decimal(6,2) NOT NULL DEFAULT '32.00',
      comprimentoCm decimal(6,2) NOT NULL DEFAULT '3.00',
      marca varchar(128) NOT NULL DEFAULT 'Qtok Quadros',
      modelo varchar(128),
      ean varchar(32),
      tempoGarantia varchar(64) NOT NULL DEFAULT '30 dias',
      exibirAtivo boolean NOT NULL DEFAULT true,
      exibirNaLoja boolean NOT NULL DEFAULT true,
      sourceDriveFileId varchar(128),
      sourceDriveFileUrl text,
      productDriveFolderId varchar(128),
      productDriveFolderUrl text,
      imageUrl1 text, imageUrl2 text, imageUrl3 text, imageUrl4 text, imageUrl5 text,
      aiPotencialVenda int,
      aiPalavrasChave text,
      aiPublicoAlvo text,
      status enum('suggested','approved','generating','generated','exported','rejected','error') NOT NULL DEFAULT 'suggested',
      errorMessage text,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      approvedAt timestamp NULL,
      generatedAt timestamp NULL,
      exportedAt timestamp NULL,
      PRIMARY KEY (id),
      UNIQUE KEY products_sku_idx (sku)
    )
  `);

  console.log("[startupMigrate] ensureSchema OK");
}
