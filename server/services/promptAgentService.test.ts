import { describe, it, expect, beforeAll } from 'vitest';
import { promptAgentService } from './promptAgentService';

describe('PromptAgentService', () => {
  // ─── getPrompt ────────────────────────────────────────────────────────────

  describe('getPrompt', () => {
    it('retorna prompt de lifestyle scandinavian com moldura de pinho', () => {
      const prompt = promptAgentService.getPrompt('lifestyle', 'pine', 'scandinavian');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('retorna prompt de lifestyle modern com moldura de alumínio', () => {
      const prompt = promptAgentService.getPrompt('lifestyle', 'aluminum', 'modern');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('retorna prompt de mockup com moldura de pinho', () => {
      const prompt = promptAgentService.getPrompt('mockup', 'pine');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('retorna prompt de mockup com moldura de alumínio', () => {
      const prompt = promptAgentService.getPrompt('mockup', 'aluminum');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('retorna prompt de vídeo com moldura de pinho', () => {
      const prompt = promptAgentService.getPrompt('video', 'pine');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('retorna prompt de vídeo com moldura de alumínio', () => {
      const prompt = promptAgentService.getPrompt('video', 'aluminum');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('usa scandinavian como padrão quando environmentType não é fornecido para lifestyle', () => {
      const promptComPadrao = promptAgentService.getPrompt('lifestyle', 'pine');
      const promptExplicito = promptAgentService.getPrompt('lifestyle', 'pine', 'scandinavian');
      expect(promptComPadrao).toBe(promptExplicito);
    });

    it('lança erro para combinação de chave inválida', () => {
      // @ts-expect-error testando entrada inválida intencional
      expect(() => promptAgentService.getPrompt('lifestyle', 'pine', 'tropical')).toThrow(
        /Prompt not found/
      );
    });
  });

  // ─── generatePromptVariations ─────────────────────────────────────────────

  describe('generatePromptVariations', () => {
    it('gera todas as variações quando nenhum tipo é especificado (padrão)', () => {
      const variations = promptAgentService.generatePromptVariations();
      // lifestyle: 2 frames × 5 envs = 10
      // mockup:    2 frames × 1      = 2
      // video:     2 frames × 1      = 2
      // Total = 14
      expect(variations).toHaveLength(14);
    });

    it('gera apenas variações de lifestyle quando solicitado', () => {
      const variations = promptAgentService.generatePromptVariations(['lifestyle']);
      expect(variations).toHaveLength(10);
      variations.forEach(v => expect(v.type).toBe('lifestyle'));
    });

    it('gera apenas variações de mockup quando solicitado', () => {
      const variations = promptAgentService.generatePromptVariations(['mockup']);
      expect(variations).toHaveLength(2);
      variations.forEach(v => expect(v.type).toBe('mockup'));
    });

    it('gera apenas variações de vídeo quando solicitado', () => {
      const variations = promptAgentService.generatePromptVariations(['video']);
      expect(variations).toHaveLength(2);
      variations.forEach(v => expect(v.type).toBe('video'));
    });

    it('gera variações para múltiplos tipos combinados', () => {
      const variations = promptAgentService.generatePromptVariations(['lifestyle', 'mockup']);
      expect(variations).toHaveLength(12); // 10 lifestyle + 2 mockup
    });

    it('cada variação contém os campos obrigatórios', () => {
      const variations = promptAgentService.generatePromptVariations();
      for (const v of variations) {
        expect(v).toHaveProperty('type');
        expect(v).toHaveProperty('frameType');
        expect(v).toHaveProperty('prompt');
        expect(['lifestyle', 'mockup', 'video']).toContain(v.type);
        expect(['pine', 'aluminum']).toContain(v.frameType);
        expect(typeof v.prompt).toBe('string');
        expect(v.prompt.length).toBeGreaterThan(0);
      }
    });

    it('variações de lifestyle incluem environmentType', () => {
      const variations = promptAgentService.generatePromptVariations(['lifestyle']);
      variations.forEach(v => {
        expect(v.environmentType).toBeDefined();
        expect(['scandinavian', 'modern', 'corporate', 'kitchen', 'kids']).toContain(v.environmentType);
      });
    });

    it('variações de mockup e vídeo não incluem environmentType', () => {
      const variations = promptAgentService.generatePromptVariations(['mockup', 'video']);
      variations.forEach(v => {
        expect(v.environmentType).toBeUndefined();
      });
    });

    it('cobre ambos os tipos de moldura (pine e aluminum) em cada tipo de entrega', () => {
      const variations = promptAgentService.generatePromptVariations(['mockup']);
      const frameTypes = variations.map(v => v.frameType);
      expect(frameTypes).toContain('pine');
      expect(frameTypes).toContain('aluminum');
    });

    it('prompts de pinho e alumínio são diferentes entre si', () => {
      const pinePrompt = promptAgentService.getPrompt('mockup', 'pine');
      const aluminumPrompt = promptAgentService.getPrompt('mockup', 'aluminum');
      expect(pinePrompt).not.toBe(aluminumPrompt);
    });
  });
});
