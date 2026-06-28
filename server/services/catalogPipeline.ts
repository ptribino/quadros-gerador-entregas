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
import { googleDriveService } from "./googleDriveService";
import { googleImagenService } from "./freepikService";
import { promptAgentService, FRAMES, STYLES } from "./promptAgentService";
import type { FrameType, RoomType, StyleType } from "./promptAgentService";

export type { FrameType, RoomType, StyleType };

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
}

export interface PipelineResult {
  productFolderId: string;
  productFolderUrl: string;
  imageUrls: string[]; // URLs públicas das 3 imagens geradas (lifestyle, profissional, mockup)
}

/** Sorteia um item de uma lista. */
function pickRandom<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

/**
 * Cômodos elegíveis para a lifestyle "regular" do catálogo automatizado.
 * Excluímos `office` (esse é forçado na lifestyle profissional) e ambientes
 * "molhados" (bathroom, gourmet_area) que costumam render quadros mal.
 */
const REGULAR_ROOMS: readonly RoomType[] = [
  "living_room",
  "bedroom",
  "kids_room",
  "kitchen",
];

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
): Promise<{ buffer: Buffer; mimeType: string }> {
  const prompt = promptAgentService.getPrompt("lifestyle", frame, room, style);
  return runGeneration(prompt, referenceDataUrl, `lifestyle/${frame}/${room}/${style}`);
}

async function generateMockup(
  frame: FrameType,
  referenceDataUrl: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const prompt = promptAgentService.getPrompt("mockup", frame);
  return runGeneration(prompt, referenceDataUrl, `mockup/${frame}`);
}

async function runGeneration(
  prompt: string,
  referenceDataUrl: string,
  label: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const result = await googleImagenService.generateImages({
    prompt,
    referenceImageUrl: referenceDataUrl,
    numImages: 1,
    aspectRatio: "3:4",
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

  const origExt = originalMime.includes("png") ? "png" : "jpg";
  await googleDriveService.uploadFile(
    accessToken,
    `${product.sku}-original.${origExt}`,
    originalBuffer,
    originalMime,
    hdFolder.id,
  );

  // Moldura única para todas as 3 imagens do produto
  const frame: FrameType = pickRandom(FRAMES);

  // Sorteios independentes de cômodo + estilo
  const regularRoom: RoomType = pickRandom(REGULAR_ROOMS);
  const regularStyle: StyleType = pickRandom(STYLES);
  const proStyle: StyleType = pickRandom(STYLES);

  // ETAPA 2 — Lifestyle regular (cômodo + estilo sorteados)
  const lifeRaw = await generateLifestyle(frame, regularRoom, regularStyle, referenceDataUrl);
  const life = await fitForEcommerce(lifeRaw.buffer);
  const lifeFile = await googleDriveService.uploadFile(
    accessToken,
    `${product.sku}-lifestyle-${frame}-${regularRoom}-${regularStyle}.jpg`,
    life.buffer,
    life.mimeType,
    lifestyleFolder.id,
  );
  await googleDriveService.makePublic(accessToken, lifeFile.id);
  await onProgress?.(1, `lifestyle ${frame}/${regularRoom}/${regularStyle}`);

  // ETAPA 3 — Lifestyle profissional (cômodo fixo = office + estilo sorteado)
  const proRaw = await generateLifestyle(frame, "office", proStyle, referenceDataUrl);
  const pro = await fitForEcommerce(proRaw.buffer);
  const proFile = await googleDriveService.uploadFile(
    accessToken,
    `${product.sku}-lifestyle-${frame}-office-${proStyle}.jpg`,
    pro.buffer,
    pro.mimeType,
    lifestyleFolder.id,
  );
  await googleDriveService.makePublic(accessToken, proFile.id);
  await onProgress?.(2, `lifestyle ${frame}/office/${proStyle}`);

  // ETAPA 4 — Mockup
  const mockRaw = await generateMockup(frame, referenceDataUrl);
  const mock = await fitForEcommerce(mockRaw.buffer);
  const mockFile = await googleDriveService.uploadFile(
    accessToken,
    `${product.sku}-mockup-${frame}.jpg`,
    mock.buffer,
    mock.mimeType,
    mockupFolder.id,
  );
  await googleDriveService.makePublic(accessToken, mockFile.id);
  await onProgress?.(3, `mockup ${frame}`);

  // imageUrls[0..2] = lifestyle, profissional, mockup
  // imageUrls[3]    = referência de tamanhos (mesma para todos os produtos)
  const imageUrls = [
    googleDriveService.publicDownloadUrl(lifeFile.id),
    googleDriveService.publicDownloadUrl(proFile.id),
    googleDriveService.publicDownloadUrl(mockFile.id),
  ];
  if (ENV.driveSizeReferenceFileId) {
    imageUrls.push(googleDriveService.publicDownloadUrl(ENV.driveSizeReferenceFileId));
  }

  return {
    productFolderId: productFolder.id,
    productFolderUrl: productFolder.webViewLink,
    imageUrls,
  };
}
