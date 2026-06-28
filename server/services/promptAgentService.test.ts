import { describe, it, expect } from 'vitest';
import { promptAgentService } from './promptAgentService';

describe('PromptAgentService', () => {
  // ─── getPrompt ────────────────────────────────────────────────────────────

  describe('getPrompt', () => {
    it('retorna prompt de lifestyle combinando moldura + cômodo + estilo', () => {
      const prompt = promptAgentService.getPrompt('lifestyle', 'light_wood', 'living_room', 'scandinavian');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
      // Sanity check: o prompt deve refletir o estilo/cômodo escolhidos.
      expect(prompt.toLowerCase()).toContain('scandinavian');
      expect(prompt.toLowerCase()).toContain('living room');
      expect(prompt.toLowerCase()).toContain('light oak wood');
    });

    it('retorna prompt diferente para cada combinação cômodo×estilo', () => {
      const a = promptAgentService.getPrompt('lifestyle', 'black', 'bedroom', 'boho');
      const b = promptAgentService.getPrompt('lifestyle', 'black', 'kitchen', 'japandi');
      expect(a).not.toBe(b);
    });

    it('reforça a fidelidade absoluta da arte em todos os prompts lifestyle', () => {
      const prompt = promptAgentService.getPrompt('lifestyle', 'white', 'office', 'minimalist');
      expect(prompt).toContain('ABSOLUTE FIDELITY');
    });

    it('retorna prompt de mockup para cada moldura', () => {
      for (const frame of ['light_wood', 'dark_wood', 'white', 'black'] as const) {
        const prompt = promptAgentService.getPrompt('mockup', frame);
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(50);
        expect(prompt).toContain('ABSOLUTE FIDELITY');
      }
    });

    it('retorna prompt de vídeo para cada moldura', () => {
      for (const frame of ['light_wood', 'dark_wood', 'white', 'black'] as const) {
        const prompt = promptAgentService.getPrompt('video', frame);
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(50);
        expect(prompt).toContain('ABSOLUTE FIDELITY');
      }
    });

    it('lança erro quando lifestyle é chamado sem roomType ou styleType', () => {
      // @ts-expect-error testando entrada inválida intencional
      expect(() => promptAgentService.getPrompt('lifestyle', 'light_wood')).toThrow(
        /lifestyle requires roomType and styleType/,
      );
    });
  });

  // ─── buildVariationsForRequest ────────────────────────────────────────────

  describe('buildVariationsForRequest', () => {
    it('produz 1 variação por delivery type solicitado', () => {
      const variations = promptAgentService.buildVariationsForRequest({
        deliveryTypes: ['lifestyle', 'mockup', 'video'],
        frameType: 'light_wood',
        roomType: 'living_room',
        styleType: 'scandinavian',
      });
      expect(variations).toHaveLength(3);
      expect(variations.map((v) => v.type)).toEqual(['lifestyle', 'mockup', 'video']);
    });

    it('preserva frame/room/style apenas onde fazem sentido', () => {
      const variations = promptAgentService.buildVariationsForRequest({
        deliveryTypes: ['lifestyle', 'mockup'],
        frameType: 'black',
        roomType: 'office',
        styleType: 'industrial',
      });

      const lifestyle = variations.find((v) => v.type === 'lifestyle')!;
      expect(lifestyle.roomType).toBe('office');
      expect(lifestyle.styleType).toBe('industrial');
      expect(lifestyle.frameType).toBe('black');

      const mockup = variations.find((v) => v.type === 'mockup')!;
      expect(mockup.roomType).toBeUndefined();
      expect(mockup.styleType).toBeUndefined();
      expect(mockup.frameType).toBe('black');
    });

    it('lança erro quando lifestyle é pedido sem room/style', () => {
      expect(() =>
        promptAgentService.buildVariationsForRequest({
          deliveryTypes: ['lifestyle'],
          frameType: 'white',
        }),
      ).toThrow(/lifestyle requires roomType and styleType/);
    });

    it('permite mockup/video sem room/style', () => {
      const variations = promptAgentService.buildVariationsForRequest({
        deliveryTypes: ['mockup', 'video'],
        frameType: 'dark_wood',
      });
      expect(variations).toHaveLength(2);
    });
  });
});
