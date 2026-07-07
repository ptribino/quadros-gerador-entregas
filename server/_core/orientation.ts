import sharp from "sharp";

export type Orientation = "vertical" | "horizontal";

/**
 * Detecta a orientação real da arte (largura vs altura) a partir dos bytes
 * da imagem, depois de auto-rotacionar por EXIF — sem isso, uma foto tirada
 * na horizontal mas com tag EXIF de rotação apareceria como vertical aqui.
 * Usado pelo pipeline pra decidir se o quadro deve ser apresentado em
 * paisagem (largo) em vez do padrão retrato.
 */
export async function detectOrientation(buffer: Buffer): Promise<Orientation> {
  try {
    const { width, height } = await sharp(buffer).rotate().metadata();
    if (!width || !height) return "vertical";
    return width > height ? "horizontal" : "vertical";
  } catch {
    return "vertical";
  }
}
