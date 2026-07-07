import { describe, it, expect } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// Funções utilitárias extraídas do driveRouter para testes isolados
// (dataUrlToBuffer e getUserAccessToken são funções internas — testamos via
//  comportamento equivalente recriando a mesma lógica aqui)
// ──────────────────────────────────────────────────────────────────────────────

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } {
  if (dataUrl.startsWith('data:')) {
    const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
    const mimeType = mimeMatch?.[1] || 'image/png';
    const base64 = dataUrl.split(',')[1];
    if (!base64) throw new Error('Invalid data URL');
    return { buffer: Buffer.from(base64, 'base64'), mimeType };
  }
  throw new Error('Formato de URL não suportado.');
}

// ──────────────────────────────────────────────────────────────────────────────

describe('driveRouter — utilitário dataUrlToBuffer', () => {
  it('converte data URL PNG corretamente', () => {
    // Imagem mínima de 1×1 pixel em PNG (base64 real)
    const tiny1x1 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const { buffer, mimeType } = dataUrlToBuffer(tiny1x1);

    expect(mimeType).toBe('image/png');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('converte data URL JPEG corretamente', () => {
    const jpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U';
    const { buffer, mimeType } = dataUrlToBuffer(jpegDataUrl);

    expect(mimeType).toBe('image/jpeg');
    expect(Buffer.isBuffer(buffer)).toBe(true);
  });

  it('usa image/png como mimeType padrão quando não reconhece o tipo', () => {
    // Data URL sem mime type explícito (não seguindo o padrão)
    const dataUrl = 'data:;base64,SGVsbG8=';
    const { mimeType } = dataUrlToBuffer(dataUrl);
    expect(mimeType).toBe('image/png');
  });

  it('lança erro para URL não-data (ex: URL HTTP)', () => {
    expect(() => dataUrlToBuffer('https://example.com/imagem.png')).toThrow(
      'Formato de URL não suportado.'
    );
  });

  it('lança erro para data URL sem a parte base64', () => {
    // Simulando data URL malformada — sem conteúdo após a vírgula
    expect(() => dataUrlToBuffer('data:image/png;base64,')).toThrow('Invalid data URL');
  });

  it('decodifica corretamente o conteúdo base64', () => {
    const originalText = 'Quadros Qtok';
    const base64 = Buffer.from(originalText).toString('base64');
    const dataUrl = `data:text/plain;base64,${base64}`;

    const { buffer, mimeType } = dataUrlToBuffer(dataUrl);

    expect(mimeType).toBe('text/plain');
    expect(buffer.toString('utf-8')).toBe(originalText);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Testes de lógica de nomenclatura de arquivos (lógica inline do driveRouter)
// ──────────────────────────────────────────────────────────────────────────────

describe('driveRouter — lógica de nomenclatura de arquivos', () => {
  type FrameType = 'light_wood' | 'dark_wood' | 'white' | 'black';

  function buildFileName(
    type: 'lifestyle' | 'mockup' | 'video',
    frameType: FrameType,
    fileName: string,
    date = '2026-04-12'
  ) {
    return `quadros-${type}-${frameType}-${date}-${fileName}`;
  }

  it('gera nome de arquivo com prefixo correto para lifestyle-light_wood', () => {
    const name = buildFileName('lifestyle', 'light_wood', 'quadro-1.png');
    expect(name).toMatch(/^quadros-lifestyle-light_wood-\d{4}-\d{2}-\d{2}-quadro-1\.png$/);
  });

  it('gera nome de arquivo com prefixo correto para mockup-black', () => {
    const name = buildFileName('mockup', 'black', 'arte.jpg');
    expect(name).toMatch(/^quadros-mockup-black-\d{4}-\d{2}-\d{2}-arte\.jpg$/);
  });

  it('inclui a data no nome do arquivo', () => {
    const name = buildFileName('video', 'light_wood', 'video.mp4', '2026-04-12');
    expect(name).toContain('2026-04-12');
  });

  it('inclui o nome original do arquivo ao final', () => {
    const originalName = 'minha-arte.png';
    const name = buildFileName('mockup', 'dark_wood', originalName);
    expect(name.endsWith(originalName)).toBe(true);
  });
});
