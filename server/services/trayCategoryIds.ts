/**
 * IDs numéricos da árvore de categorias da Tray (export
 * `categorias_1480066_...csv` baixado pela Priscila em 2026-07-08) — única
 * fonte de verdade pros IDs usados no export multi-categoria de produtos
 * (`exportTrayImport`, catalogRouter.ts).
 *
 * Chave = caminho "Nível1", "Nível1>Nível2" ou "Nível1>Nível2>Nível3" (mesmos
 * nomes gravados em `category_codes.trayCategoriaPrincipal` /
 * `traySubcategoria` / `trayEstiloAdicional`).
 */
import type { RoomType } from "./promptAgentService";

export const TRAY_CATEGORY_ID: Record<string, number> = {
  Ambientes: 53,
  "Ambientes>Sala": 67,
  "Ambientes>Quarto": 69,
  "Ambientes>Escritório": 71,
  "Ambientes>Cozinha": 73,
  "Ambientes>Lavabo": 75,
  "Ambientes>Área Gourmet": 77,

  Estilos: 55,
  "Estilos>Geométricos": 15,
  "Estilos>Abstratos": 13,
  "Estilos>Line Art": 21,
  "Estilos>Minimalistas": 23,
  "Estilos>Japandi": 79,
  "Estilos>Boho": 81,
  "Estilos>Clássicos": 83,
  "Estilos>Contemporâneos": 85,

  Temas: 57,
  "Temas>Animais": 25,
  "Temas>Botânicos": 11,
  "Temas>Natureza e Paisagens": 87,
  "Temas>Frases": 17,
  "Temas>Kids/Infantil": 29,
  "Temas>Gastronomia e Bebidas": 89,
  "Temas>Galáxias e Planetas": 91,
  "Temas>Cidades": 19,
  "Temas>Femininos": 43,
  "Temas>Veículos": 93,
  "Temas>Religiosos": 107,
  "Temas>Animais>Leões": 111,
  "Temas>Animais>Águia": 113,

  Artistas: 103,
  "Artistas>Jairo Rosas": 105,
  "Artistas>Renan Santos": 109,
};

/**
 * RoomType (já usado pra escolher o cômodo da lifestyle gerada) → chave de
 * TRAY_CATEGORY_ID pra virar categoria adicional "Ambientes" no export.
 * `kids_room` fica de fora: não existe subcategoria de Ambientes
 * correspondente na árvore da Tray hoje.
 */
export const ROOM_TO_TRAY_AMBIENTE: Partial<Record<RoomType, string>> = {
  living_room: "Ambientes>Sala",
  bedroom: "Ambientes>Quarto",
  office: "Ambientes>Escritório",
  kitchen: "Ambientes>Cozinha",
  bathroom: "Ambientes>Lavabo",
  gourmet_area: "Ambientes>Área Gourmet",
};

/**
 * Sub-subcategorias (nível 3) de Temas>Animais já cadastradas na Tray hoje.
 * Mesma técnica de keyword-matching de `POWERFUL_SUBJECT_KEYWORDS`
 * (catalogPipeline.ts) — essa lista tem mais bichos (lobo, coruja, gavião,
 * tigre, pantera, onça) que ainda não viraram categoria nível-3 na Tray;
 * quando a Priscila criar essas categorias lá, é só adicionar uma entrada
 * aqui com o ID novo.
 */
const NIVEL3_ANIMAIS: ReadonlyArray<{ keywords: readonly string[]; nivel3: string }> = [
  { keywords: ["leão", "leao", "lion", "lioness"], nivel3: "Leões" },
  { keywords: ["águia", "aguia", "eagle"], nivel3: "Águia" },
];

/**
 * Detecta a sub-subcategoria (nível 3) de Temas>Animais a partir das
 * palavras-chave da IA — só ativa quando a subcategoria (nível 2) do produto
 * já é "Animais", pra não marcar nível 3 de animal em produto de outra
 * categoria que por acaso cite "leão"/"águia" no texto.
 */
export function detectNivel3(
  aiPalavrasChave: string | null | undefined,
  traySubcategoria: string | null | undefined,
): string | null {
  if (traySubcategoria !== "Animais" || !aiPalavrasChave) return null;
  const text = aiPalavrasChave.toLowerCase();
  for (const { keywords, nivel3 } of NIVEL3_ANIMAIS) {
    if (keywords.some((kw) => text.includes(kw))) return nivel3;
  }
  return null;
}

/**
 * Monta a lista de IDs de categoria ADICIONAL (Ambientes derivados dos
 * cômodos elegíveis da categoria + Estilo, se a categoria tiver um definido)
 * pro export de produtos. Dedupe e ignora chaves sem ID mapeado.
 */
export function buildAdditionalCategoryIds(args: {
  eligibleRooms: readonly RoomType[];
  trayEstiloAdicional?: string | null;
}): number[] {
  const ids = new Set<number>();

  for (const room of args.eligibleRooms) {
    const key = ROOM_TO_TRAY_AMBIENTE[room];
    const id = key ? TRAY_CATEGORY_ID[key] : undefined;
    if (id) ids.add(id);
  }

  if (args.trayEstiloAdicional) {
    const id = TRAY_CATEGORY_ID[`Estilos>${args.trayEstiloAdicional}`];
    if (id) ids.add(id);
  }

  return Array.from(ids);
}
