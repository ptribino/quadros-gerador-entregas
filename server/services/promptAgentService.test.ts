import { describe, it, expect } from 'vitest';
import { promptAgentService } from './promptAgentService';

describe('PromptAgentService', () => {
  // ─── getPrompt ────────────────────────────────────────────────────────────

  describe('getPrompt', () => {
    it('retorna prompt de lifestyle scandinavian com moldura amadeirado claro', () => {
      const prompt = promptAgentService.getPrompt('lifestyle', 'light_wood', 'scandinavian');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('retorna prompt de lifestyle modern com moldura preta', () => {
      const prompt = promptAgentService.getPrompt('lifestyle', 'black', 'modern');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('retorna prompt de mockup com moldura amadeirado escuro', () => {
      const prompt = promptAgentService.getPrompt('mockup', 'dark_wood');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('retorna prompt de mockup com moldura branca', () => {
      const prompt = promptAgentService.getPrompt('mockup', 'white');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('retorna prompt de vídeo para todas as 4 molduras', () => {
      for (const frame of ['light_wood', 'dark_wood', 'white', 'black'] as const) {
        const prompt = promptAgentService.getPrompt('video', frame);
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(20);
      }
    });

    it('usa scandinavian como padrão quando environmentType não é fornecido para lifestyle', () => {
      const promptComPadrao = promptAgentService.getPrompt('lifestyle', 'light_wood');
      const promptExplicito = promptAgentService.getPrompt('lifestyle', 'light_wood', 'scandinavian');
      expect(promptComPadrao).toBe(promptExplicito);
    });

    it('lança erro para combinação de chave inválida', () => {
      // @ts-expect-error testando entrada inválida intencional
      expect(() => promptAgentService.getPrompt('lifestyle', 'light_wood', 'tropical')).toThrow(
        /Prompt not found/
      );
    });
  });

  // ─── generatePromptVariations ─────────────────────────────────────────────

  describe('generatePromptVariations', () => {
    it('gera todas as variações quando nenhum tipo é especificado (padrão)', () => {
      const variations = promptAgentService.generatePromptVariations();
      // lifestyle: 4 frames × 5 envs = 20
      // mockup:    4 frames × 1      = 4
      // video:     4 frames × 1      = 4
      // Total = 28
      expect(variations).toHaveLength(28);
    });

    it('gera apenas variações de lifestyle quando solicitado', () => {
      const variations = promptAgentService.generatePromptVariations(['lifestyle']);
      expect(variations).toHaveLength(20);
      variations.forEach((v) => expect(v.type).toBe('lifestyle'));
    });

    it('gera apenas variações de mockup quando solicitado', () => {
      const variations = promptAgentService.generatePromptVariations(['mockup']);
      expect(variations).toHaveLength(4);
      variations.forEach((v) => expect(v.type).toBe('mockup'));
    });

    it('gera apenas variações de vídeo quando solicitado', () => {
      const variations = promptAgentService.generatePromptVariations(['video']);
      expect(variations).toHaveLength(4);
      variations.forEach((v) => expect(v.type).toBe('video'));
    });

    it('gera variações para múltiplos tipos combinados', () => {
      const variations = promptAgentService.generatePromptVariations(['lifestyle', 'mockup']);
      expect(variations).toHaveLength(24); // 20 lifestyle + 4 mockup
    });

    it('cada variação contém os campos obrigatórios', () => {
      const variations = promptAgentService.generatePromptVariations();
      for (const v of variations) {
        expect(v).toHaveProperty('type');
        expect(v).toHaveProperty('frameType');
        expect(v).toHaveProperty('prompt');
        expect(['lifestyle', 'mockup', 'video']).toContain(v.type);
        expect(['light_wood', 'dark_wood', 'white', 'black']).toContain(v.frameType);
        expect(typeof v.prompt).toBe('string');
        expect(v.prompt.length).toBeGreaterThan(0);
      }
    });

    it('variações de lifestyle incluem environmentType', () => {
      const variations = promptAgentService.generatePromptVariations(['lifestyle']);
      variations.forEach((v) => {
        expect(v.environmentType).toBeDefined();
        expect(['scandinavian', 'modern', 'corporate', 'kitchen', 'kids']).toContain(v.environmentType);
      });
    });

    it('variações de mockup e vídeo não incluem environmentType', () => {
      const variations = promptAgentService.generatePromptVariations(['mockup', 'video']);
      variations.forEach((v) => {
        expect(v.environmentType).toBeUndefined();
      });
    });

    it('cobre todas as 4 molduras em cada tipo de entrega', () => {
      const variations = promptAgentService.generatePromptVariations(['mockup']);
      const frameTypes = variations.map((v) => v.frameType);
      expect(frameTypes).toContain('light_wood');
      expect(frameTypes).toContain('dark_wood');
      expect(frameTypes).toContain('white');
      expect(frameTypes).toContain('black');
    });

    it('prompts das 4 molduras são distintos entre si', () => {
      const prompts = (['light_wood', 'dark_wood', 'white', 'black'] as const).map((frame) =>
        promptAgentService.getPrompt('mockup', frame),
      );
      const unique = new Set(prompts);
      expect(unique.size).toBe(4);
    });
  });
});
