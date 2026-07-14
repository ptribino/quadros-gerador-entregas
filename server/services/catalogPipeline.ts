/**
 * Pipeline do Passo 2 + Passo 3 do mapa mental:
 *  1. Baixa a imagem original do banco (Drive da GN Packz, via OAuth)
 *  2. Gera 6 imagens com Gemini via Batch API (2 lifestyles + mockup base +
 *     3 recolors de moldura) — assíncrono, em duas fases (ver catalogWorker.ts)
 *  3. Cria pasta `[SKU] Nome/` no Drive da Priscila (DRIVE_DESTINATION_FOLDER_ID)
 *  4. Faz upload de original + geradas, define permissão pública
 *  5. Devolve URLs públicas (uc?export=download) prontas pra planilha Tray
 *
 * Este módulo não chama o Gemini diretamente — só monta prompts/specs de
 * task (`prepareProduct`, `buildPhaseBTasks`) e faz a montagem final a
 * partir de resultados já prontos (`assembleProduct`). Quem efetivamente
 * submete/consulta o lote na Gemini Batch API é `catalogWorker.ts`, via
 * `googleImagenService.submitBatch`/`getBatch` (freepikService.ts).
 */
import sharp from "sharp";
import { ENV } from "../_core/env";
import { detectOrientation } from "../_core/orientation";
import { googleDriveService } from "./googleDriveService";
import { promptAgentService, FRAMES, framesForStyle } from "./promptAgentService";
import type { FrameType, RoomType, StyleType, Orientation } from "./promptAgentService";

export type { FrameType, RoomType, StyleType, Orientation };

export interface PipelineDeps {
  /** Token Google OAuth do usuário dono do produto. */
  accessToken: string;
}

export interface PipelineProduct {
  id: number;
  sku: string;
  nome: string;
  sourceDriveFileId: string | null;
  sourceDriveMimeType?: string;
  /** code3 da categoria (ex: "INF", "BBD"). Usado pra escolher cômodos compatíveis. */
  categoryCode3?: string | null;
  /** Palavras-chave da curadoria por IA. Usado pra detectar artes imponentes (águia/leão/lobo) que pedem cenário de escritório. */
  aiPalavrasChave?: string | null;
  /**
   * Estilo escolhido manualmente pelo usuário antes de enfileirar a geração.
   * Se omitido, o pipeline usa o padrão de marca `goquadros_signature` nas
   * duas lifestyles — mantendo o sortimento visualmente consistente.
   */
  styleOverride?: StyleType | null;
}

/**
 * Termos que sinalizam arte imponente/séria — quando aparecem nas palavras-chave
 * da IA, o pipeline força ao menos UMA das lifestyles em office (escritório
 * fica muito melhor pra esses temas do que sala/quarto aconchegante).
 */
const POWERFUL_SUBJECT_KEYWORDS: readonly string[] = [
  "águia", "aguia", "eagle",
  "leão", "leao", "lion", "lioness",
  "lobo", "wolf",
  "coruja", "owl",
  "gavião", "gaviao", "hawk", "falcão", "falcao", "falcon",
  "tigre", "tiger",
  "pantera", "panteira", "panther",
  "jaguar", "onça", "onca",
];

function prefersOfficeScene(aiPalavrasChave: string | null | undefined): boolean {
  if (!aiPalavrasChave) return false;
  const text = aiPalavrasChave.toLowerCase();
  return POWERFUL_SUBJECT_KEYWORDS.some((kw) => text.includes(kw));
}

export interface PipelineResult {
  productFolderId: string;
  productFolderUrl: string;
  imageUrls: string[]; // URLs públicas das 4 imagens (original web-fit, lifestyle 1, lifestyle 2, mockup)
  /** URL do mockup gerado para CADA cor de moldura — 1 por FrameType. */
  mockupUrls: Record<FrameType, string>;
}

/** Sorteia um item de uma lista. */
function pickRandom<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

/**
 * Sorteia dois itens DISTINTOS de uma lista (sem reposição). Se a lista só
 * tem 1 item, retorna o mesmo item duas vezes — não tem como evitar.
 */
function pickTwoDistinct<T>(list: readonly T[]): [T, T] {
  const first = pickRandom(list);
  if (list.length === 1) return [first, first];
  const rest = list.filter((item) => item !== first);
  return [first, pickRandom(rest)];
}

/**
 * Cômodos "universais" — cabem qualquer arte temática genérica (paisagens,
 * abstratos, animais, frases, etc.). Padronizado em sala + cozinha/jantar
 * pra manter o sortimento consistente com o padrão visual do goquadros.com.br
 * (decidido com a Priscila em 2026-07-03). Quarto, escritório, lavabo e área
 * gourmet ficam restritos às categorias que já pedem explicitamente por eles
 * via CATEGORY_ROOM_AFFINITY (ex: VEI → escritório/quarto).
 */
const UNIVERSAL_ROOMS: readonly RoomType[] = ["living_room", "kitchen"];

/**
 * Mapa categoria (code3) → cômodos elegíveis para a geração de lifestyle.
 * Categorias temáticas não listadas caem em UNIVERSAL_ROOMS.
 *
 * Confirmado com Priscila em 2026-06-28. Ajustar aqui se a estratégia mudar.
 */
const CATEGORY_ROOM_AFFINITY: Record<string, readonly RoomType[]> = {
  INF: ["kids_room"],                                       // Tema Infantil
  BBD: ["kitchen", "gourmet_area"],                         // Bebidas e Drinks
  WIN: ["kitchen", "gourmet_area"],                         // Wine and Red
  VEI: ["office", "bedroom"],                               // Veículos Diversos
  MUF: ["bedroom", "living_room", "bathroom"],              // Mulheres Floridas
  GLX: ["bedroom", "kids_room", "office"],                  // Galáxias e Planetas
  FLO: ["living_room", "bedroom", "bathroom", "kitchen"],   // Flores e Plantas
};

export function roomsForCategory(code3: string | null | undefined): readonly RoomType[] {
  if (!code3) return UNIVERSAL_ROOMS;
  return CATEGORY_ROOM_AFFINITY[code3] ?? UNIVERSAL_ROOMS;
}

/**
 * Sanitiza o nome do produto para virar nome de pasta no Drive.
 * Remove caracteres que o Drive não aceita e limita comprimento.
 */
function sanitizeFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "").slice(0, 100).trim();
}

const MAX_DIMENSION = 2500;
const MAX_FILE_BYTES = 1024 * 1024;

async function fitForEcommerce(
  buffer: Buffer,
): Promise<{ buffer: Buffer; mimeType: string }> {
  let pipeline = sharp(buffer).rotate().resize({
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  });

  for (const quality of [85, 75, 65, 55, 45]) {
    const out = await pipeline
      .clone()
      .jpeg({ quality, progressive: true, mozjpeg: true })
      .toBuffer();
    if (out.length <= MAX_FILE_BYTES) {
      return { buffer: out, mimeType: "image/jpeg" };
    }
  }
  const fallback = await sharp(buffer)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 60, progressive: true, mozjpeg: true })
    .toBuffer();
  return { buffer: fallback, mimeType: "image/jpeg" };
}

function aspectRatioFor(orientation: Orientation): "4:3" | "3:4" {
  return orientation === "horizontal" ? "4:3" : "3:4";
}

/** Parâmetros sorteados uma única vez no início da geração de um produto. */
export interface GenParams {
  frame: FrameType;
  orientation: Orientation;
  regularRoom: RoomType;
  regularStyle: StyleType;
  proRoom: RoomType;
  proStyle: StyleType;
  /** ID do arquivo "-web.jpg" (arte original sem moldura/ambiente), já criado na Etapa 0. */
  originalWebFileId: string;
}

/** Especificação de UMA chamada de geração de imagem — vira 1 request no lote Gemini. */
export interface GenTaskSpec {
  kind: "lifestyle_regular" | "lifestyle_pro" | "mockup_base" | "mockup_recolor";
  /** Só usado em mockup_base/mockup_recolor — qual cor de moldura essa task representa. */
  frameColor?: FrameType;
  prompt: string;
  referenceImageB64: string;
  referenceMimeType: string;
  aspectRatio: "4:3" | "3:4";
}

export interface PreparedProduct {
  productFolderId: string;
  productFolderUrl: string;
  genParams: GenParams;
  /** As 3 tasks independentes da fase A: lifestyle_regular, lifestyle_pro, mockup_base. */
  phaseATasks: GenTaskSpec[];
}

/**
 * ETAPA 0 do pipeline — roda de forma síncrona e imediata (não depende do
 * Gemini, só de Drive): cria a pasta do produto, baixa e sobe a arte
 * original, sorteia frame/room/style/orientation, e monta as specs das 3
 * tasks de geração da fase A. Quem chama (catalogWorker.ts) persiste
 * `genParams` e insere `phaseATasks` como linhas de `product_gen_tasks`.
 */
export async function prepareProduct(
  product: PipelineProduct,
  deps: PipelineDeps,
): Promise<PreparedProduct> {
  if (!ENV.driveDestinationFolderId) {
    throw new Error("DRIVE_DESTINATION_FOLDER_ID não configurado");
  }
  if (!product.sourceDriveFileId) {
    throw new Error("Produto sem sourceDriveFileId — não há imagem original para usar como referência");
  }

  const { accessToken } = deps;

  // ETAPA 0 — Pasta do produto
  const folderName = `[${product.sku}] ${sanitizeFolderName(product.nome)}`;
  const productFolder = await googleDriveService.getOrCreateFolder(
    accessToken,
    folderName,
    ENV.driveDestinationFolderId,
  );

  const [hdFolder, lifestyleFolder, mockupFolder] = await Promise.all([
    googleDriveService.getOrCreateFolder(accessToken, "01_HD_Original", productFolder.id),
    googleDriveService.getOrCreateFolder(accessToken, "02_Lifestyle", productFolder.id),
    googleDriveService.getOrCreateFolder(accessToken, "03_Mockups", productFolder.id),
  ]);
  // lifestyleFolder/mockupFolder não são usadas aqui — recriadas (idempotente,
  // get-or-create por nome) em assembleProduct, quando os uploads acontecem.
  void lifestyleFolder;
  void mockupFolder;

  // Baixar original pra salvar sem resize e detectar orientação.
  const originalBuffer = await googleDriveService.downloadFile(accessToken, product.sourceDriveFileId);
  const originalMime = product.sourceDriveMimeType || "image/jpeg";

  // Orientação real da arte (largura vs altura) — quadros horizontais (ex:
  // obras clássicas tipo "Santa Ceia") precisam ser apresentados em paisagem
  // em vez do padrão retrato do catálogo.
  const orientation = await detectOrientation(originalBuffer);

  // Nomes ESTÁVEIS — sem incluir frame/room/style sorteados, pra que o cleanup
  // (uploadFileReplacing) consiga encontrar o arquivo antigo no caso de re-geração.

  // Salva o original sem resize (arquivo / impressão)
  const origExt = originalMime.includes("png") ? "png" : "jpg";
  await googleDriveService.uploadFileReplacing(
    accessToken,
    `${product.sku}-original.${origExt}`,
    originalBuffer,
    originalMime,
    hdFolder.id,
  );

  // Versão "web" da arte original (sem moldura/ambiente) — vira a imageUrl1
  // do produto na Tray. Mesmo pipeline de compressão usado pelos lifestyles.
  const originalWeb = await fitForEcommerce(originalBuffer);
  const originalWebFile = await googleDriveService.uploadFileReplacing(
    accessToken,
    `${product.sku}-web.jpg`,
    originalWeb.buffer,
    originalWeb.mimeType,
    hdFolder.id,
  );
  await googleDriveService.makePublic(accessToken, originalWebFile.id);

  // Referência enviada ao Gemini e gravada em product_gen_tasks: usa a
  // versão comprimida (≤1MB, mesma do upload "web" acima), não o arquivo
  // original — a fase A insere 3 tasks numa única query, cada uma com sua
  // própria cópia da referência, e um original grande (comum em arte de
  // impressão) estourava o max_allowed_packet do MySQL, derrubando o
  // produto inteiro com "Failed query: insert into product_gen_tasks...".
  // 2500px/≤1MB é resolução de sobra pra um modelo de visão usar como
  // referência de estilo/conteúdo.
  const referenceB64 = originalWeb.buffer.toString("base64");
  const referenceMime = originalWeb.mimeType;

  // Padrão de marca: as duas lifestyles usam o estilo único goquadros_signature,
  // pra manter o sortimento visualmente coeso com goquadros.com.br. Se o
  // usuário escolheu um estilo manualmente na fila, ele prevalece nas duas.
  const regularStyle: StyleType = product.styleOverride ?? "goquadros_signature";
  const proStyle: StyleType = product.styleOverride ?? "goquadros_signature";

  // Moldura única pras 3 imagens do produto — escolhida em função do estilo
  // do lifestyle "principal" pra manter coerência. Mockup usa a mesma moldura
  // (apresentação isolada, sem ambiente).
  const frame: FrameType = pickRandom(framesForStyle(regularStyle));

  // Cômodos elegíveis dependem da categoria do produto (ex: INF → só kids_room).
  const eligibleRooms = roomsForCategory(product.categoryCode3);

  // Como as duas lifestyles agora usam o MESMO estilo (goquadros_signature),
  // o cômodo é a única fonte de variedade entre elas — sorteios independentes
  // colidiam sempre que o pool padrão (sala + cozinha, só 2 opções) caía duas
  // vezes no mesmo cômodo. Sorteia sem reposição pra garantir cômodos
  // diferentes sempre que a categoria permitir mais de um.
  const [regularRoom, proRoomRandom] = pickTwoDistinct(eligibleRooms);
  // Arte de animal imponente (águia, leão, lobo etc.) vai pra office na
  // segunda lifestyle quando office estiver elegível. Cobre o caso de quadros
  // que ficam estranhos em sala/quarto aconchegante e melhor em escritório.
  const forceOffice =
    prefersOfficeScene(product.aiPalavrasChave) && eligibleRooms.includes("office");
  const proRoom: RoomType = forceOffice ? "office" : proRoomRandom;

  const aspectRatio = aspectRatioFor(orientation);

  const phaseATasks: GenTaskSpec[] = [
    {
      kind: "lifestyle_regular",
      prompt: promptAgentService.getPrompt("lifestyle", frame, regularRoom, regularStyle, orientation),
      referenceImageB64: referenceB64,
      referenceMimeType: referenceMime,
      aspectRatio,
    },
    {
      kind: "lifestyle_pro",
      prompt: promptAgentService.getPrompt("lifestyle", frame, proRoom, proStyle, orientation),
      referenceImageB64: referenceB64,
      referenceMimeType: referenceMime,
      aspectRatio,
    },
    {
      kind: "mockup_base",
      frameColor: frame,
      prompt: promptAgentService.getPrompt("mockup", frame, orientation),
      referenceImageB64: referenceB64,
      referenceMimeType: referenceMime,
      aspectRatio,
    },
  ];

  return {
    productFolderId: productFolder.id,
    productFolderUrl: productFolder.webViewLink,
    genParams: {
      frame,
      orientation,
      regularRoom,
      regularStyle,
      proRoom,
      proStyle,
      originalWebFileId: originalWebFile.id,
    },
    phaseATasks,
  };
}

/**
 * Monta as 3 tasks da fase B (recolors de moldura) a partir do resultado
 * JÁ GERADO do mockup_base da fase A — repinta só a moldura, preservando
 * ângulo, corte, luz e profundidade da foto-base. Gerar cada cor do zero a
 * partir da arte crua produzia fotos visivelmente diferentes entre as 4
 * cores (câmera, corte, até a arte renderizada de forma distinta).
 */
export function buildPhaseBTasks(
  genParams: GenParams,
  mockupBaseResultB64: string,
  mockupBaseResultMimeType: string,
): GenTaskSpec[] {
  const otherFrames = FRAMES.filter((f) => f !== genParams.frame);
  const aspectRatio = aspectRatioFor(genParams.orientation);

  return otherFrames.map((toFrame) => ({
    kind: "mockup_recolor" as const,
    frameColor: toFrame,
    prompt: promptAgentService.buildMockupRecolorPrompt(toFrame, genParams.orientation),
    referenceImageB64: mockupBaseResultB64,
    referenceMimeType: mockupBaseResultMimeType,
    aspectRatio,
  }));
}

/** Resultado de UMA task já concluída, pronto pra montagem final. */
export interface GenTaskResult {
  kind: GenTaskSpec["kind"];
  frameColor?: FrameType;
  b64Data: string;
  mimeType: string;
}

/**
 * Montagem final — roda depois que TODAS as 6 tasks (fase A + fase B) de
 * um produto estão prontas. Reaproveita exatamente a lógica de upload/URLs
 * que antes vivia no fim de `runForProduct`: recria (idempotente, por nome)
 * as subpastas de Drive, sobe cada imagem já gerada, define permissão
 * pública, e monta `imageUrls`/`mockupUrls` na mesma ordem de sempre.
 */
export async function assembleProduct(
  product: PipelineProduct,
  deps: PipelineDeps,
  genParams: GenParams,
  results: GenTaskResult[],
): Promise<PipelineResult> {
  if (!ENV.driveDestinationFolderId) {
    throw new Error("DRIVE_DESTINATION_FOLDER_ID não configurado");
  }

  const { accessToken } = deps;
  const { frame } = genParams;

  const folderName = `[${product.sku}] ${sanitizeFolderName(product.nome)}`;
  const productFolder = await googleDriveService.getOrCreateFolder(
    accessToken,
    folderName,
    ENV.driveDestinationFolderId,
  );
  const [lifestyleFolder, mockupFolder] = await Promise.all([
    googleDriveService.getOrCreateFolder(accessToken, "02_Lifestyle", productFolder.id),
    googleDriveService.getOrCreateFolder(accessToken, "03_Mockups", productFolder.id),
  ]);

  const findResult = (kind: GenTaskSpec["kind"], frameColor?: FrameType): GenTaskResult => {
    const found = results.find((r) => r.kind === kind && (frameColor ? r.frameColor === frameColor : true));
    if (!found) throw new Error(`Resultado ausente para ${kind}${frameColor ? `/${frameColor}` : ""}`);
    return found;
  };

  // ETAPA 2 — Lifestyle "regular"
  const lifeRaw = findResult("lifestyle_regular");
  const life = await fitForEcommerce(Buffer.from(lifeRaw.b64Data, "base64"));
  const lifeFile = await googleDriveService.uploadFileReplacing(
    accessToken,
    `${product.sku}-lifestyle-1.jpg`,
    life.buffer,
    life.mimeType,
    lifestyleFolder.id,
  );
  await googleDriveService.makePublic(accessToken, lifeFile.id);

  // ETAPA 3 — Segunda lifestyle
  const proRaw = findResult("lifestyle_pro");
  const pro = await fitForEcommerce(Buffer.from(proRaw.b64Data, "base64"));
  const proFile = await googleDriveService.uploadFileReplacing(
    accessToken,
    `${product.sku}-lifestyle-2.jpg`,
    pro.buffer,
    pro.mimeType,
    lifestyleFolder.id,
  );
  await googleDriveService.makePublic(accessToken, proFile.id);

  // ETAPA 4 — Mockups: UMA imagem por cor de moldura. São essas 4 fotos
  // que viram a "imagem principal da variação" de cada opção de Moldura na
  // planilha de variações Tray (ex: "Preta" → foto do mockup na moldura
  // preta).
  const mockupUrls = {} as Record<FrameType, string>;

  const baseRaw = findResult("mockup_base", frame);
  const baseFitted = await fitForEcommerce(Buffer.from(baseRaw.b64Data, "base64"));
  const baseFile = await googleDriveService.uploadFileReplacing(
    accessToken,
    `${product.sku}-mockup-${frame}.jpg`,
    baseFitted.buffer,
    baseFitted.mimeType,
    mockupFolder.id,
  );
  await googleDriveService.makePublic(accessToken, baseFile.id);
  mockupUrls[frame] = googleDriveService.publicDownloadUrl(baseFile.id);

  const otherFrames = FRAMES.filter((f) => f !== frame);
  for (const otherFrame of otherFrames) {
    const recoloredRaw = findResult("mockup_recolor", otherFrame);
    const recolored = await fitForEcommerce(Buffer.from(recoloredRaw.b64Data, "base64"));
    const file = await googleDriveService.uploadFileReplacing(
      accessToken,
      `${product.sku}-mockup-${otherFrame}.jpg`,
      recolored.buffer,
      recolored.mimeType,
      mockupFolder.id,
    );
    await googleDriveService.makePublic(accessToken, file.id);
    mockupUrls[otherFrame] = googleDriveService.publicDownloadUrl(file.id);
  }

  // Ordem das imagens na planilha Tray:
  //   imageUrls[0] = arte original web-fit (sem moldura/ambiente) — imagem principal
  //   imageUrls[1] = lifestyle 1
  //   imageUrls[2] = lifestyle 2
  //   imageUrls[3] = mockup — usa a moldura escolhida pra coerência com as lifestyles
  const imageUrls = [
    googleDriveService.publicDownloadUrl(genParams.originalWebFileId),
    googleDriveService.publicDownloadUrl(lifeFile.id),
    googleDriveService.publicDownloadUrl(proFile.id),
    mockupUrls[frame],
  ];

  return {
    productFolderId: productFolder.id,
    productFolderUrl: productFolder.webViewLink,
    imageUrls,
    mockupUrls,
  };
}
