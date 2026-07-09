/**
 * Pipeline do Passo 2 + Passo 3 do mapa mental:
 *  1. Baixa a imagem original do banco (Drive da GN Packz, via OAuth)
 *  2. Gera 3 imagens com Gemini (lifestyle + lifestyle profissional + mockup)
 *  3. Cria pasta `[SKU] Nome/` no Drive da Priscila (DRIVE_DESTINATION_FOLDER_ID)
 *  4. Faz upload de original + geradas, define permissão pública
 *  5. Devolve URLs públicas (uc?export=download) prontas pra planilha Tray
 *
 * Cada produto = 1 invocação de `runForProduct`. O worker chama esta
 * função em background uma vez por job da fila.
 */
import sharp from "sharp";
import { ENV } from "../_core/env";
import { detectOrientation } from "../_core/orientation";
import { googleDriveService } from "./googleDriveService";
import { googleImagenService } from "./freepikService";
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
  imageUrls: string[]; // URLs públicas das 3 imagens geradas (lifestyle, profissional, mockup)
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

/**
 * Gera UMA imagem chamando o gerador existente (Gemini 2.5 Flash Image).
 */
async function generateLifestyle(
  frame: FrameType,
  room: RoomType,
  style: StyleType,
  referenceDataUrl: string,
  orientation: Orientation,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const prompt = promptAgentService.getPrompt("lifestyle", frame, room, style, orientation);
  return runGeneration(prompt, referenceDataUrl, `lifestyle/${frame}/${room}/${style}`, orientation);
}

async function generateMockup(
  frame: FrameType,
  referenceDataUrl: string,
  orientation: Orientation,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const prompt = promptAgentService.getPrompt("mockup", frame, orientation);
  return runGeneration(prompt, referenceDataUrl, `mockup/${frame}`, orientation);
}

/**
 * Deriva um mockup em OUTRA cor de moldura a partir de um mockup JÁ
 * GERADO (não a arte crua) — repinta só a moldura, preservando ângulo,
 * corte, luz e profundidade da foto-base. Gerar cada cor do zero a partir
 * da arte crua produzia fotos visivelmente diferentes entre as 4 cores
 * (câmera, corte, até a arte renderizada de forma distinta).
 */
async function recolorMockup(
  toFrame: FrameType,
  baseMockupDataUrl: string,
  orientation: Orientation,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const prompt = promptAgentService.buildMockupRecolorPrompt(toFrame, orientation);
  return runGeneration(prompt, baseMockupDataUrl, `mockup-recolor/${toFrame}`, orientation);
}

async function runGeneration(
  prompt: string,
  referenceDataUrl: string,
  label: string,
  orientation: Orientation,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const result = await googleImagenService.generateImages({
    prompt,
    referenceImageUrl: referenceDataUrl,
    numImages: 1,
    aspectRatio: orientation === "horizontal" ? "4:3" : "3:4",
  });

  const img = result.images?.[0];
  if (result.status !== "completed" || !img?.b64Data) {
    throw new Error(`Falha na geração ${label}: ${result.error ?? "sem imagem"}`);
  }

  return {
    buffer: Buffer.from(img.b64Data, "base64"),
    mimeType: img.mimeType || "image/jpeg",
  };
}

/**
 * Roda o pipeline completo para um produto.
 * Chama de dentro do worker; retorna URLs públicas das 3 imagens.
 *
 * `onProgress` é chamado depois de cada subetapa concluída (1..3),
 * permitindo persistir progresso parcial no DB.
 */
export async function runForProduct(
  product: PipelineProduct,
  deps: PipelineDeps,
  onProgress?: (step: number, message: string) => Promise<void> | void,
): Promise<PipelineResult> {
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

  // ETAPA 1 — Baixar original e ter como data URL pra usar nas gerações
  const originalBuffer = await googleDriveService.downloadFile(accessToken, product.sourceDriveFileId);
  const originalMime = product.sourceDriveMimeType || "image/jpeg";
  const referenceDataUrl = `data:${originalMime};base64,${originalBuffer.toString("base64")}`;

  // Orientação real da arte (largura vs altura) — quadros horizontais (ex:
  // obras clássicas tipo "Santa Ceia") precisam ser apresentados em paisagem
  // em vez do padrão retrato do catálogo.
  const orientation = await detectOrientation(originalBuffer);

  // Nomes ESTÁVEIS — sem incluir frame/room/style sorteados, pra que o cleanup
  // (uploadFileReplacing) consiga encontrar o arquivo antigo no caso de re-geração.
  // A info do sorteio fica nos logs via onProgress (e em genError se falhar).

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

  // ETAPA 2 — Lifestyle "regular"
  const lifeRaw = await generateLifestyle(frame, regularRoom, regularStyle, referenceDataUrl, orientation);
  const life = await fitForEcommerce(lifeRaw.buffer);
  const lifeFile = await googleDriveService.uploadFileReplacing(
    accessToken,
    `${product.sku}-lifestyle-1.jpg`,
    life.buffer,
    life.mimeType,
    lifestyleFolder.id,
  );
  await googleDriveService.makePublic(accessToken, lifeFile.id);
  await onProgress?.(1, `lifestyle ${frame}/${regularRoom}/${regularStyle}`);

  // ETAPA 3 — Segunda lifestyle (mesmo pool de cômodos, sorteio independente)
  const proRaw = await generateLifestyle(frame, proRoom, proStyle, referenceDataUrl, orientation);
  const pro = await fitForEcommerce(proRaw.buffer);
  const proFile = await googleDriveService.uploadFileReplacing(
    accessToken,
    `${product.sku}-lifestyle-2.jpg`,
    pro.buffer,
    pro.mimeType,
    lifestyleFolder.id,
  );
  await googleDriveService.makePublic(accessToken, proFile.id);
  await onProgress?.(2, `lifestyle ${frame}/${proRoom}/${proStyle}`);

  // ETAPA 4 — Mockups: UMA imagem por cor de moldura. São essas 4 fotos
  // que viram a "imagem principal da variação" de cada opção de Moldura na
  // planilha de variações Tray (ex: "Preta" → foto do mockup na moldura
  // preta). A 1ª (mesma moldura escolhida pra coerência com as lifestyles)
  // é gerada a partir da arte crua; as outras 3 são DERIVADAS dessa mesma
  // foto (repintando só a moldura) em vez de geradas do zero — gerar cada
  // cor independentemente produzia fotos com ângulo/corte/profundidade
  // diferentes entre si, quebrando a consistência da variação.
  const mockupUrls = {} as Record<FrameType, string>;
  const [baseFrame, ...otherFrames] = [frame, ...FRAMES.filter((f) => f !== frame)];

  const baseRaw = await generateMockup(baseFrame, referenceDataUrl, orientation);
  const baseReferenceDataUrl = `data:${baseRaw.mimeType};base64,${baseRaw.buffer.toString("base64")}`;
  const baseFitted = await fitForEcommerce(baseRaw.buffer);
  const baseFile = await googleDriveService.uploadFileReplacing(
    accessToken,
    `${product.sku}-mockup-${baseFrame}.jpg`,
    baseFitted.buffer,
    baseFitted.mimeType,
    mockupFolder.id,
  );
  await googleDriveService.makePublic(accessToken, baseFile.id);
  mockupUrls[baseFrame] = googleDriveService.publicDownloadUrl(baseFile.id);

  for (const otherFrame of otherFrames) {
    const recoloredRaw = await recolorMockup(otherFrame, baseReferenceDataUrl, orientation);
    const recolored = await fitForEcommerce(recoloredRaw.buffer);
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
  await onProgress?.(3, `mockups (${FRAMES.join(", ")})`);

  // Ordem das imagens na planilha Tray:
  //   imageUrls[0] = arte original web-fit (sem moldura/ambiente) — imagem principal
  //   imageUrls[1] = lifestyle 1
  //   imageUrls[2] = lifestyle 2
  //   imageUrls[3] = mockup — usa a moldura escolhida pra coerência com as lifestyles
  const imageUrls = [
    googleDriveService.publicDownloadUrl(originalWebFile.id),
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
