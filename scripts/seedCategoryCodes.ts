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
//
// trayEstiloAdicional: subcategoria de Estilos a exportar como categoria
// ADICIONAL (além da principal), pra categorias cuja principal já é Temas —
// evita cadastro manual de Estilo na Tray depois da importação. null quando
// a principal já é Estilos (redundante) ou quando nenhum Estilo combina.
// Mantenha em sincronia com server/_core/startupMigrate.ts (SEEDS).
const SEEDS = [
  { folderName: "#AB Artes Abstratas",     displayName: "Artes Abstratas",     code3: "ABS", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Abstratos", trayEstiloAdicional: null as string | null },
  // ACL: pasta renomeada no Drive (Arte Clássica → Arte Cósmica). Conteúdo mudou
  // pra arte mística/espiritual com paleta cósmica vibrante — mapeamento Tray
  // vira Estilos/Contemporâneos por padrão; ajustar se Priscila criar categoria dedicada.
  { folderName: "#AC Arte Cósmica",        displayName: "Arte Cósmica",        code3: "ACL", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Contemporâneos", trayEstiloAdicional: null as string | null },
  { folderName: "#AL Alcohol Ink",         displayName: "Alcohol Ink",         code3: "AIK", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Abstratos", trayEstiloAdicional: null as string | null },
  { folderName: "#AN Vida Animal",         displayName: "Vida Animal",         code3: "ANI", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Animais", trayEstiloAdicional: "Clássicos" as string | null },
  { folderName: "#BD Bebidas e Drinks",    displayName: "Bebidas e Drinks",    code3: "BBD", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Gastronomia e Bebidas", trayEstiloAdicional: "Contemporâneos" as string | null },
  { folderName: "#ES Esculturas Hipsters", displayName: "Esculturas Hipsters", code3: "ESC", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Contemporâneos", trayEstiloAdicional: null as string | null },
  { folderName: "#FG Formas Geométricas",  displayName: "Formas Geométricas",  code3: "FGE", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Geométricos", trayEstiloAdicional: null as string | null },
  { folderName: "#FP Flores e Plantas",    displayName: "Flores e Plantas",    code3: "FLO", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Botânicos", trayEstiloAdicional: "Boho" as string | null },
  { folderName: "#FR Frases e Citações",   displayName: "Frases e Citações",   code3: "FRA", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Frases", trayEstiloAdicional: "Minimalistas" as string | null },
  { folderName: "#GP Galáxias e Planetas", displayName: "Galáxias e Planetas", code3: "GLX", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Galáxias e Planetas", trayEstiloAdicional: "Contemporâneos" as string | null },
  { folderName: "#IN Tema Infantil",       displayName: "Tema Infantil",       code3: "INF", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Kids/Infantil", trayEstiloAdicional: null as string | null },
  { folderName: "#MF Mulheres Floridas",   displayName: "Mulheres Floridas",   code3: "MUF", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Femininos", trayEstiloAdicional: "Boho" as string | null },
  { folderName: "#PN Paisagens Naturais",  displayName: "Paisagens Naturais",  code3: "PAI", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Natureza e Paisagens", trayEstiloAdicional: "Clássicos" as string | null },
  { folderName: "#PO Pinturas a Óleo",     displayName: "Pinturas a Óleo",     code3: "POL", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Clássicos", trayEstiloAdicional: null as string | null },
  // TRD: placeholder. Priscila vai criar categoria "Trios" na Tray e me passa o caminho.
  { folderName: "#TD Trios Diversos",      displayName: "Trios Diversos",      code3: "TRD", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Trios", trayEstiloAdicional: null as string | null },
  { folderName: "#VD Veículos Diversos",   displayName: "Veículos Diversos",   code3: "VEI", trayCategoriaPrincipal: "Temas",   traySubcategoria: "Veículos", trayEstiloAdicional: "Contemporâneos" as string | null },
  // WIN: pasta renomeada no Drive (Wine and Red → White and Red). Conteúdo
  // mudou de bebidas pra paleta cromática vermelho/branco — mapeamento Tray
  // vira Estilos/Contemporâneos por padrão; ajustar se Priscila preferir outro.
  { folderName: "#WR White and Red",       displayName: "White and Red",       code3: "WIN", trayCategoriaPrincipal: "Estilos", traySubcategoria: "Contemporâneos", trayEstiloAdicional: null as string | null },
  // Categorias reais da Tray (export de categorias, 2026-07-05) sem pasta
  // correspondente no banco de imagens do Drive — ficam "(sem pasta)" no
  // dropdown de categoria da curadoria, então quem gerar sugestões com elas
  // precisa colar o link da pasta manualmente (folderId não é auto-preenchido).
  { folderName: "Sala",         displayName: "Sala",         code3: "SAL", trayCategoriaPrincipal: "Ambientes", traySubcategoria: "Sala", trayEstiloAdicional: null as string | null },
  { folderName: "Quarto",       displayName: "Quarto",       code3: "QRT", trayCategoriaPrincipal: "Ambientes", traySubcategoria: "Quarto", trayEstiloAdicional: null as string | null },
  { folderName: "Escritório",   displayName: "Escritório",   code3: "ESR", trayCategoriaPrincipal: "Ambientes", traySubcategoria: "Escritório", trayEstiloAdicional: null as string | null },
  { folderName: "Cozinha",      displayName: "Cozinha",      code3: "COZ", trayCategoriaPrincipal: "Ambientes", traySubcategoria: "Cozinha", trayEstiloAdicional: null as string | null },
  { folderName: "Lavabo",       displayName: "Lavabo",       code3: "LAV", trayCategoriaPrincipal: "Ambientes", traySubcategoria: "Lavabo", trayEstiloAdicional: null as string | null },
  { folderName: "Área Gourmet", displayName: "Área Gourmet", code3: "GOU", trayCategoriaPrincipal: "Ambientes", traySubcategoria: "Área Gourmet", trayEstiloAdicional: null as string | null },
  { folderName: "Line Art",     displayName: "Line Art",     code3: "LNA", trayCategoriaPrincipal: "Estilos",   traySubcategoria: "Line Art", trayEstiloAdicional: null as string | null },
  { folderName: "Minimalistas", displayName: "Minimalistas", code3: "MIN", trayCategoriaPrincipal: "Estilos",   traySubcategoria: "Minimalistas", trayEstiloAdicional: null as string | null },
  { folderName: "Japandi",      displayName: "Japandi",      code3: "JAP", trayCategoriaPrincipal: "Estilos",   traySubcategoria: "Japandi", trayEstiloAdicional: null as string | null },
  { folderName: "Boho",         displayName: "Boho",         code3: "BOH", trayCategoriaPrincipal: "Estilos",   traySubcategoria: "Boho", trayEstiloAdicional: null as string | null },
  { folderName: "Cidades",      displayName: "Cidades",      code3: "CID", trayCategoriaPrincipal: "Temas",     traySubcategoria: "Cidades", trayEstiloAdicional: "Contemporâneos" as string | null },
  { folderName: "Religiosos",   displayName: "Religiosos",   code3: "REL", trayCategoriaPrincipal: "Temas",     traySubcategoria: "Religiosos", trayEstiloAdicional: null as string | null },
  { folderName: "Jairo Rosas",  displayName: "Jairo Rosas",  code3: "JRO", trayCategoriaPrincipal: "Artistas",  traySubcategoria: "Jairo Rosas", trayEstiloAdicional: null as string | null },
  { folderName: "Renan Santos", displayName: "Renan Santos", code3: "RSA", trayCategoriaPrincipal: "Artistas",  traySubcategoria: "Renan Santos", trayEstiloAdicional: null as string | null },
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
        trayEstiloAdicional: seed.trayEstiloAdicional,
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
