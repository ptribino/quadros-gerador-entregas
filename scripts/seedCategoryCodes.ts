/**
 * Seed idempotente da tabela `category_codes`.
 *
 * Mapeia cada pasta do banco de imagens no Drive ("Catálogo Imagens") para:
 *   - code3: 3 letras usadas no SKU (ex: QTK-001-FLO-...)
 *   - taxonomia Tray (Categoria Principal / Subcategoria)
 *
 * Uso:   pnpm tsx scripts/seedCategoryCodes.ts
 * Reexecutar é seguro: usa onDuplicateKeyUpdate.
 */
import { categoryCodes } from "../drizzle/schema";
import { getDb } from "../server/db";

const SEEDS = [
  { folderName: "#AB Artes Abstratas",     displayName: "Artes Abstratas",     code3: "ABS", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Abstratos" },
  { folderName: "#AC Arte Clássica",       displayName: "Arte Clássica",       code3: "ACL", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Clássicos" },
  { folderName: "#AI Alcohol Ink",         displayName: "Alcohol Ink",         code3: "AIK", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Abstratos" },
  { folderName: "#AN Vida Animal",         displayName: "Vida Animal",         code3: "ANI", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Animais" },
  { folderName: "#BD Bebidas e Drinks",    displayName: "Bebidas e Drinks",    code3: "BBD", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Gastronomia" },
  { folderName: "#ES Esculturas Hipsters", displayName: "Esculturas Hipsters", code3: "ESC", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Esculturas" },
  { folderName: "#FG Formas Geométricas",  displayName: "Formas Geométricas",  code3: "FGE", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Geométricos" },
  { folderName: "#FP Flores e Plantas",    displayName: "Flores e Plantas",    code3: "FLO", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Florais" },
  { folderName: "#FR Frases e Citações",   displayName: "Frases e Citações",   code3: "FRA", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Frases" },
  { folderName: "#GP Galaxias e Planetas", displayName: "Galáxias e Planetas", code3: "GLX", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Espaço" },
  { folderName: "#IN Tema Infantil",       displayName: "Tema Infantil",       code3: "INF", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Infantil" },
  { folderName: "#MF Mulheres Floridas",   displayName: "Mulheres Floridas",   code3: "MUF", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Femininos" },
  { folderName: "#PN Paisagens Naturais",  displayName: "Paisagens Naturais",  code3: "PAI", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Paisagens" },
  { folderName: "#PO Pinturas a Óleo",     displayName: "Pinturas a Óleo",     code3: "POL", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Pinturas" },
  { folderName: "#TD Trios Diversos",      displayName: "Trios Diversos",      code3: "TRD", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Trios" },
  { folderName: "#VD Veículos Diversos",   displayName: "Veículos Diversos",   code3: "VEI", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Veículos" },
  { folderName: "#WR Wine and Red",        displayName: "Wine and Red",        code3: "WIN", trayCategoriaPrincipal: "Quadros Decorativos", traySubcategoria: "Vinhos" },
];

async function run() {
  const db = await getDb();
  if (!db) {
    console.error("DATABASE_URL não configurado. Abortando.");
    process.exit(1);
  }

  for (const seed of SEEDS) {
    await db.insert(categoryCodes).values(seed).onDuplicateKeyUpdate({
      set: {
        displayName: seed.displayName,
        trayCategoriaPrincipal: seed.trayCategoriaPrincipal,
        traySubcategoria: seed.traySubcategoria,
      },
    });
    console.log(`  ✓ ${seed.code3.padEnd(3)}  ${seed.displayName}`);
  }

  console.log(`\nSeed concluído: ${SEEDS.length} categorias.`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Seed falhou:", err);
  process.exit(1);
});
