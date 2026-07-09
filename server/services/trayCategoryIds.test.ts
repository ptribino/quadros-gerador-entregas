import { describe, expect, it } from "vitest";
import { buildAdditionalCategoryIds, detectNivel3, TRAY_CATEGORY_ID } from "./trayCategoryIds";

describe("detectNivel3", () => {
  it("detecta Leões a partir das palavras-chave dentro de Temas>Animais", () => {
    expect(detectNivel3("leão majestoso, savana, dourado", "Animais")).toBe("Leões");
  });

  it("detecta Águia a partir das palavras-chave dentro de Temas>Animais", () => {
    expect(detectNivel3("águia real, céu, montanha", "Animais")).toBe("Águia");
  });

  it("não ativa fora de Temas>Animais mesmo com a palavra-chave presente", () => {
    expect(detectNivel3("leão de chácara, bar, cerveja", "Gastronomia e Bebidas")).toBeNull();
  });

  it("retorna null quando nenhuma palavra-chave bate", () => {
    expect(detectNivel3("golfinho, oceano, azul", "Animais")).toBeNull();
  });

  it("retorna null sem palavras-chave", () => {
    expect(detectNivel3(null, "Animais")).toBeNull();
    expect(detectNivel3(undefined, "Animais")).toBeNull();
  });
});

describe("buildAdditionalCategoryIds", () => {
  it("junta Ambientes (Sala+Cozinha) com o Estilo adicional (Clássicos), sem duplicar", () => {
    const ids = buildAdditionalCategoryIds({
      eligibleRooms: ["living_room", "kitchen"],
      trayEstiloAdicional: "Clássicos",
    });
    expect(ids).toEqual(
      expect.arrayContaining([
        TRAY_CATEGORY_ID["Ambientes>Sala"],
        TRAY_CATEGORY_ID["Ambientes>Cozinha"],
        TRAY_CATEGORY_ID["Estilos>Clássicos"],
      ]),
    );
    expect(ids).toHaveLength(3);
  });

  it("ignora kids_room (sem Ambientes correspondente na Tray)", () => {
    const ids = buildAdditionalCategoryIds({ eligibleRooms: ["kids_room"] });
    expect(ids).toEqual([]);
  });

  it("não adiciona nada quando não há trayEstiloAdicional", () => {
    const ids = buildAdditionalCategoryIds({ eligibleRooms: [], trayEstiloAdicional: null });
    expect(ids).toEqual([]);
  });

  it("dedupe quando o mesmo cômodo aparece repetido", () => {
    const ids = buildAdditionalCategoryIds({
      eligibleRooms: ["living_room", "living_room", "kitchen"],
    });
    expect(ids).toHaveLength(2);
  });
});
