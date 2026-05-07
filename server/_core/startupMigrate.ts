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

  let connection: mysql.Connection | null = null;
  try {
    connection = await mysql.createConnection(url);
    const db = drizzle(connection);

    console.log("[startupMigrate] Aplicando migrations de", migrationsFolder);
    await migrate(db, { migrationsFolder });
    console.log("[startupMigrate] Migrations OK");

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
      // affectedRows: 1 = inserido, 2 = atualizado, 0 = noop
      if (result?.[0]?.affectedRows === 1) inserted += 1;
    }
    console.log(`[startupMigrate] Seed categorias OK (${inserted} novas, ${SEEDS.length - inserted} já existiam)`);
  } catch (err) {
    console.error(
      "[startupMigrate] Falha (não fatal — servidor continua):",
      err instanceof Error ? err.message : err,
    );
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}
