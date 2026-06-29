/**
 * Seed idempotente da tabela `category_codes`.
 *
 * Mapeia cada pasta do banco de imagens no Drive ("Catálogo Imagens") para:
 *   - code3: 3 letras usadas no SKU (ex: QTK-001-FLO-...)
 *   - taxonomia Tray (Categoria Principal / Subcategoria)
 *
 * Uso:   pnpm db:seed:categories
 * Reexecutar é seguro: usa onDuplicateKeyUpdate.
 */
import "dotenv/config";
import { categoryCodes } from "../drizzle/schema";
import { getDb } from "../server/db";

// Mapeamento code3 → (Tray catN1, Tray catN2) usando as categorias reais
// cadastradas na loja (export de categorias da Tray, jun/2026).
// Cada produto sobe na planilha com 1 categoria principal — escolhida pela
// dimensão temática mais forte (Temas) ou estilística (Estilos).
// TRD (Trios) está em "Temas/Trios" como placeholder até a Priscila criar
// essa subcategoria na Tray (sugerido nível 1: Temas).
const SEEDS = [
  { folderName: "#AB Artes Abstratas",     displayName: "Artes Abstratas",     code3: "ABS", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Abstratos" },
  // ACL: pasta renomeada no Drive (Arte Clássica → Arte Cósmica). Conteúdo mudou
  // pra arte mística/espiritual com paleta cósmica vibrante — mapeamento Tray
  // vira Estilos/Contemporâneos por padrão; ajustar se Priscila criar categoria dedicada.
  { folderName: "#AC Arte Cósmica",        displayName: "Arte Cósmica",        code3: "ACL", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Contemporâneos" },
  { folderName: "#AL Alcohol Ink",         displayName: "Alcohol Ink",         code3: "AIK", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Abstratos" },
  { folderName: "#AN Vida Animal",         displayName: "Vida Animal",         code3: "ANI", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Animais" },
  { folderName: "#BD Bebidas e Drinks",    displayName: "Bebidas e Drinks",    code3: "BBD", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Gastronomia e Bebidas" },
  { folderName: "#ES Esculturas Hipsters", displayName: "Esculturas Hipsters", code3: "ESC", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Contemporâneos" },
  { folderName: "#FG Formas Geométricas",  displayName: "Formas Geométricas",  code3: "FGE", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Geométricos" },
  { folderName: "#FP Flores e Plantas",    displayName: "Flores e Plantas",    code3: "FLO", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Botânicos" },
  { folderName: "#FR Frases e Citações",   displayName: "Frases e Citações",   code3: "FRA", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Frases" },
  { folderName: "#GP Galáxias e Planetas", displayName: "Galáxias e Planetas", code3: "GLX", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Galáxias e Planetas" },
  { folderName: "#IN Tema Infantil",       displayName: "Tema Infantil",       code3: "INF", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Kids/Infantil" },
  { folderName: "#MF Mulheres Floridas",   displayName: "Mulheres Floridas",   code3: "MUF", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Femininos" },
  { folderName: "#PN Paisagens Naturais",  displayName: "Paisagens Naturais",  code3: "PAI", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Natureza e Paisagens" },
  { folderName: "#PO Pinturas a Óleo",     displayName: "Pinturas a Óleo",     code3: "POL", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Clássicos" },
  // TRD: placeholder. Priscila vai criar categoria "Trios" na Tray e me passa o caminho.
  { folderName: "#TD Trios Diversos",      displayName: "Trios Diversos",      code3: "TRD", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Trios" },
  { folderName: "#VD Veículos Diversos",   displayName: "Veículos Diversos",   code3: "VEI", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Veículos" },
  // WIN: pasta renomeada no Drive (Wine and Red → White and Red). Conteúdo
  // mudou de bebidas pra paleta cromática vermelho/branco — mapeamento Tray
  // vira Estilos/Contemporâneos por padrão; ajustar se Priscila preferir outro.
  { folderName: "#WR White and Red",       displayName: "White and Red",       code3: "WIN", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Contemporâneos" },
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
