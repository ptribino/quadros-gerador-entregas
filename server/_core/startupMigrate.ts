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

// Mapeamento code3 → (Tray catN1, Tray catN2) usando categorias reais da loja.
// Mantenha em sincronia com scripts/seedCategoryCodes.ts.
//
// 6º elemento = trayEstiloAdicional: subcategoria de Estilos a exportar como
// categoria ADICIONAL (além da principal), pra categorias cuja principal já é
// Temas — evita o cadastro manual de Estilo na Tray depois da importação.
// null quando a principal já é Estilos (redundante) ou quando nenhum Estilo
// combina com a categoria. Valores confirmados/ajustados com a Priscila em
// 2026-07-08 (Animais→Clássicos, Cidades→Contemporâneos); os demais são
// palpite por analogia — é só um dado, fácil de corrigir depois.
const SEEDS = [
  ["#AB Artes Abstratas",     "Artes Abstratas",     "ABS", "Estilos", "Abstratos",             null],
  // ACL: pasta renomeada (Arte Clássica → Arte Cósmica); conteúdo é arte mística/espiritual.
  ["#AC Arte Cósmica",        "Arte Cósmica",        "ACL", "Estilos", "Contemporâneos",         null],
  ["#AL Alcohol Ink",         "Alcohol Ink",         "AIK", "Estilos", "Abstratos",              null],
  ["#AN Vida Animal",         "Vida Animal",         "ANI", "Temas",   "Animais",                "Clássicos"],
  ["#BD Bebidas e Drinks",    "Bebidas e Drinks",    "BBD", "Temas",   "Gastronomia e Bebidas",  "Contemporâneos"],
  ["#ES Esculturas Hipsters", "Esculturas Hipsters", "ESC", "Estilos", "Contemporâneos",         null],
  ["#FG Formas Geométricas",  "Formas Geométricas",  "FGE", "Estilos", "Geométricos",            null],
  ["#FP Flores e Plantas",    "Flores e Plantas",    "FLO", "Temas",   "Botânicos",              "Boho"],
  ["#FR Frases e Citações",   "Frases e Citações",   "FRA", "Temas",   "Frases",                 "Minimalistas"],
  ["#GP Galáxias e Planetas", "Galáxias e Planetas", "GLX", "Temas",   "Galáxias e Planetas",    "Contemporâneos"],
  ["#IN Tema Infantil",       "Tema Infantil",       "INF", "Temas",   "Kids/Infantil",          null],
  ["#MF Mulheres Floridas",   "Mulheres Floridas",   "MUF", "Temas",   "Femininos",              "Boho"],
  ["#PN Paisagens Naturais",  "Paisagens Naturais",  "PAI", "Temas",   "Natureza e Paisagens",   "Clássicos"],
  ["#PO Pinturas a Óleo",     "Pinturas a Óleo",     "POL", "Estilos", "Clássicos",              null],
  // TRD: placeholder até Priscila criar categoria "Trios" na Tray
  ["#TD Trios Diversos",      "Trios Diversos",      "TRD", "Temas",   "Trios",                  null],
  ["#VD Veículos Diversos",   "Veículos Diversos",   "VEI", "Temas",   "Veículos",               "Contemporâneos"],
  // WIN: pasta renomeada (Wine and Red → White and Red); conteúdo mudou pra paleta cromática.
  ["#WR White and Red",       "White and Red",       "WIN", "Estilos", "Contemporâneos",         null],
  // Categorias reais da Tray (export de categorias, 2026-07-05) sem pasta
  // correspondente no banco de imagens do Drive — ficam "(sem pasta)" no
  // dropdown de categoria, então quem gerar sugestões com elas precisa
  // colar o link da pasta manualmente (folderId não é auto-preenchido).
  ["Sala",           "Sala",           "SAL", "Ambientes", "Sala",           null],
  ["Quarto",         "Quarto",         "QRT", "Ambientes", "Quarto",         null],
  ["Escritório",     "Escritório",     "ESR", "Ambientes", "Escritório",     null],
  ["Cozinha",        "Cozinha",        "COZ", "Ambientes", "Cozinha",        null],
  ["Lavabo",         "Lavabo",         "LAV", "Ambientes", "Lavabo",         null],
  ["Área Gourmet",   "Área Gourmet",   "GOU", "Ambientes", "Área Gourmet",   null],
  ["Line Art",       "Line Art",       "LNA", "Estilos",   "Line Art",       null],
  ["Minimalistas",   "Minimalistas",   "MIN", "Estilos",   "Minimalistas",   null],
  ["Japandi",        "Japandi",        "JAP", "Estilos",   "Japandi",        null],
  ["Boho",           "Boho",           "BOH", "Estilos",   "Boho",           null],
  ["Cidades",        "Cidades",        "CID", "Temas",     "Cidades",        "Contemporâneos"],
  ["Religiosos",     "Religiosos",     "REL", "Temas",     "Religiosos",     null],
  ["Jairo Rosas",    "Jairo Rosas",    "JRO", "Artistas",  "Jairo Rosas",    null],
  ["Renan Santos",   "Renan Santos",   "RSA", "Artistas",  "Renan Santos",   null],
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

    // Retry com backoff: em produção (Railway) o app bota antes do MySQL
    // estar pronto, gerando ECONNREFUSED no primeiro PING. Tenta até ~30s.
    await waitForDatabase(pool);

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
    for (const [folderName, displayName, code3, principal, sub, estiloAdicional] of SEEDS) {
      const result: any = await db.execute(
        sql`INSERT INTO category_codes
            (folderName, displayName, code3, trayCategoriaPrincipal, traySubcategoria, trayEstiloAdicional)
            VALUES (${folderName}, ${displayName}, ${code3}, ${principal}, ${sub}, ${estiloAdicional})
            ON DUPLICATE KEY UPDATE
              displayName = VALUES(displayName),
              trayCategoriaPrincipal = VALUES(trayCategoriaPrincipal),
              traySubcategoria = VALUES(traySubcategoria),
              trayEstiloAdicional = VALUES(trayEstiloAdicional)`,
      );
      if (result?.[0]?.affectedRows === 1) inserted += 1;
    }
    console.log(
      `[startupMigrate] Seed categorias OK (${inserted} novas, ${SEEDS.length - inserted} já existiam)`,
    );

    // Normaliza nomes legados: "Quadro Decorativo X" → "Quadro X".
    // Idempotente — após a primeira execução nenhum nome bate o LIKE.
    const renameResult: any = await db.execute(
      sql`UPDATE products
          SET nome = REPLACE(nome, 'Quadro Decorativo ', 'Quadro ')
          WHERE nome LIKE 'Quadro Decorativo %'`,
    );
    const affected = renameResult?.[0]?.affectedRows ?? 0;
    if (affected > 0) {
      console.log(`[startupMigrate] Renomeados ${affected} produtos: "Quadro Decorativo X" → "Quadro X"`);
    }
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
 * Aguarda o MySQL aceitar conexões. No Railway o app sobe antes do DB
 * — sem isso o startupMigrate falha com ECONNREFUSED no primeiro boot.
 */
async function waitForDatabase(pool: mysql.Pool) {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query("SELECT 1");
      if (attempt > 1) {
        console.log(`[startupMigrate] DB pronto na tentativa ${attempt}.`);
      }
      return;
    } catch (err: any) {
      if (attempt === maxAttempts) {
        throw new Error(
          `DB inacessível após ${maxAttempts} tentativas (último code=${err?.code}): ${err?.message || err}`,
        );
      }
      const waitMs = Math.min(1000 * Math.pow(1.5, attempt - 1), 5000);
      console.log(
        `[startupMigrate] DB não pronto (${err?.code || "?"}), tentando de novo em ${waitMs}ms...`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
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
      trayEstiloAdicional varchar(255),
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

  // Colunas de fila de geração (Passo 2). ALTER IGNORE-style: cada um
  // tenta criar e ignora se já existe (errno 1060 = duplicate column).
  for (const stmt of [
    "ALTER TABLE products ADD COLUMN genQueuedAt timestamp NULL",
    "ALTER TABLE products ADD COLUMN genStartedAt timestamp NULL",
    "ALTER TABLE products ADD COLUMN genCompletedAt timestamp NULL",
    "ALTER TABLE products ADD COLUMN genStep int NULL",
    "ALTER TABLE products ADD COLUMN genAttempts int NOT NULL DEFAULT 0",
    "ALTER TABLE products ADD COLUMN genError text NULL",
    // Mockup por cor de moldura — usados na planilha de variações Tray.
    "ALTER TABLE products ADD COLUMN mockupUrlLightWood text NULL",
    "ALTER TABLE products ADD COLUMN mockupUrlDarkWood text NULL",
    "ALTER TABLE products ADD COLUMN mockupUrlWhite text NULL",
    "ALTER TABLE products ADD COLUMN mockupUrlBlack text NULL",
    // Estilo adicional pro export multi-categoria (Ambientes + Estilos + Temas).
    "ALTER TABLE category_codes ADD COLUMN trayEstiloAdicional varchar(255) NULL",
  ]) {
    try {
      await pool.query(stmt);
    } catch (err: any) {
      if (err?.errno !== 1060) {
        console.warn("[startupMigrate] DDL falhou:", stmt, "→", err?.message);
      }
    }
  }

  // Backfill: corrige URLs de imageUrl4 que tenham `id=d/...` (bug de
  // sanitização do ID quando o env var foi setado com prefixo `d/`).
  try {
    const [fixRes]: any = await pool.query(
      `UPDATE products
         SET imageUrl4 = REPLACE(imageUrl4, '&id=d/', '&id=')
       WHERE imageUrl4 LIKE '%&id=d/%'`,
    );
    if (fixRes?.affectedRows) {
      console.log(`[startupMigrate] Backfill imageUrl4: ${fixRes.affectedRows} URLs corrigidas`);
    }
  } catch (err) {
    console.warn(
      "[startupMigrate] Backfill imageUrl4 falhou:",
      err instanceof Error ? err.message : err,
    );
  }

  // Backfill: encurta SKUs e modelos longos (formato antigo
  // "QTK - 001 - ABS - APC - 01 - Nome Longo Do Produto" → "QTK - 001 - ABS - APC - 01").
  // Idempotente: depois da primeira execução o WHERE não casa mais nada.
  try {
    const [skuRes]: any = await pool.query(
      `UPDATE products SET sku = SUBSTRING_INDEX(sku, ' - ', 5)
       WHERE sku LIKE '% - % - % - % - % - %'`,
    );
    const [modeloRes]: any = await pool.query(
      `UPDATE products SET modelo = SUBSTRING_INDEX(modelo, ' - ', 5)
       WHERE modelo LIKE '% - % - % - % - % - %'`,
    );
    if (skuRes?.affectedRows || modeloRes?.affectedRows) {
      console.log(
        `[startupMigrate] Backfill SKU: ${skuRes?.affectedRows ?? 0} skus, ${modeloRes?.affectedRows ?? 0} modelos encurtados`,
      );
    }
  } catch (err) {
    console.warn(
      "[startupMigrate] Backfill SKU falhou (não fatal):",
      err instanceof Error ? err.message : err,
    );
  }

  console.log("[startupMigrate] ensureSchema OK");
}
