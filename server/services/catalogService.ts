/**
 * Camada de domínio do pipeline de catálogo Tray.
 *
 * - Gera SKU no padrão Qtok: `QTK - {seq} - {cat3} - {sub3} - {var} - {nome}`
 * - Gera slug SEO da URL do produto
 * - Chama Gemini Vision para curar/enriquecer cada imagem do banco
 *
 * Tudo aqui é puro: não toca DB nem Drive (isso é responsabilidade do router).
 */
import slugify from "slugify";
import { invokeLLM } from "../_core/llm";

// ---------- SKU + slug ----------

const slugOpts = { lower: true, strict: true, locale: "pt", trim: true };

export function buildSlug(nome: string): string {
  return slugify(nome, slugOpts);
}

/**
 * Padrão observado em Catalogo_Quadros_Tray_COM_IMAGENS.xlsx:
 *   "QTK - 001 - ABS - APC - 01 - Abstrato Boho Pastel"
 * Neste primeiro corte o subcódigo (sub3) replica o cat3 — variações
 * mais finas surgem quando o catálogo tiver subdivisões reais.
 */
export function buildSku(args: {
  cat3: string;
  sub3?: string;
  seq: number;
  variant?: number;
  nome: string;
}): string {
  const sub3 = (args.sub3 || args.cat3).toUpperCase().padEnd(3, "X").slice(0, 3);
  const cat3 = args.cat3.toUpperCase().padEnd(3, "X").slice(0, 3);
  const seq = String(args.seq).padStart(3, "0");
  const variant = String(args.variant ?? 1).padStart(2, "0");
  return `QTK - ${seq} - ${cat3} - ${sub3} - ${variant} - ${args.nome}`;
}

// ---------- IA: análise de uma imagem ----------

export type AiSuggestion = {
  nome: string;
  descricaoHtml: string;
  potencialVenda: number; // 1..10
  palavrasChave: string[];
  publicoAlvo: string;
};

const SUGGESTION_SCHEMA = {
  name: "ProductSuggestion",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      nome: {
        type: "string",
        description:
          "Nome comercial curto (4-8 palavras). Começa com 'Quadro Decorativo' quando fizer sentido.",
      },
      descricaoHtml: {
        type: "string",
        description:
          "Descrição em HTML estruturado conforme o template fornecido (h2, p, h3, ul). Sem ```html, sem markdown.",
      },
      potencialVenda: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "Quão bem essa arte tende a vender em e-commerce de quadros decorativos.",
      },
      palavrasChave: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 8,
      },
      publicoAlvo: {
        type: "string",
        description: "Frase curta descrevendo quem compraria (ex: 'mulheres 25-40 com estética minimalista').",
      },
    },
    required: ["nome", "descricaoHtml", "potencialVenda", "palavrasChave", "publicoAlvo"],
  },
} as const;

const PROMPT_SISTEMA = `Você é um especialista em SEO e curadoria para e-commerce de quadros decorativos da marca Qtok Quadros.

Sua função: receber UMA imagem de arte (do banco do fabricante) e produzir os metadados comerciais para cadastro na Tray.

Regras inegociáveis:
- Escreva 100% em português brasileiro.
- O nome do produto começa com "Quadro Decorativo" quando combinar com a arte.
- A descrição é HTML puro (sem \\\`\\\`\\\`html, sem markdown), no template abaixo, preenchendo APENAS os trechos entre {{}}.
- O "potencialVenda" deve refletir honestamente quão comercial a arte é: 10 = best-seller óbvio, 1 = arte interessante mas nichada demais.
- Não invente dimensões, materiais, preços ou prazos — esses campos são preenchidos por outro sistema.

TEMPLATE DE DESCRIÇÃO (preencha apenas o que está entre {{}}):
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <h2 style="color: #1a1a1a;">{{TITULO_DESTAQUE}}</h2>
  <p>{{PARAGRAFO_INTRODUTORIO_VENDA}}</p>

  <h3 style="color: #555;">Sobre a Arte</h3>
  <p>{{DESCRICAO_VISUAL_DA_ARTE}}</p>

  <h3 style="color: #555;">Características</h3>
  <ul>
    <li>{{CARACTERISTICA_1}}</li>
    <li>{{CARACTERISTICA_2}}</li>
    <li>{{CARACTERISTICA_3}}</li>
    <li>{{CARACTERISTICA_4}}</li>
  </ul>

  <h3 style="color: #555;">Como Usar na Decoração</h3>
  <p>{{SUGESTAO_DE_AMBIENTE_E_COMBINACOES}}</p>

  <p><em>* As imagens são meramente ilustrativas. Variações de tonalidade podem ocorrer dependendo da calibração do monitor.</em></p>
</div>

Retorne APENAS o JSON conforme o schema fornecido.`;

/**
 * Analisa uma imagem do banco e devolve metadados estruturados para cadastro.
 * `imageDataUrl` deve ser um data URL (data:image/jpeg;base64,...) — é o
 * formato que `googleDriveService.getFileContent` já produz.
 */
export async function analyzeImageForCatalog(args: {
  imageDataUrl: string;
  categoria: string;
  fileName: string;
}): Promise<AiSuggestion> {
  const result = await invokeLLM({
    messages: [
      { role: "system", content: PROMPT_SISTEMA },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Categoria do banco: "${args.categoria}". Arquivo de origem: "${args.fileName}". Analise a imagem e gere os metadados.`,
          },
          { type: "image_url", image_url: { url: args.imageDataUrl, detail: "high" } },
        ],
      },
    ],
    outputSchema: SUGGESTION_SCHEMA,
    maxTokens: 4096,
  });

  const raw = result.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.find((p) => p.type === "text")?.text ?? "" : "";

  if (!text) {
    throw new Error("Gemini não retornou conteúdo textual na análise da imagem.");
  }

  let parsed: AiSuggestion;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Resposta da IA não é JSON válido: ${text.slice(0, 200)}`);
  }

  if (!parsed.nome || !parsed.descricaoHtml) {
    throw new Error("Resposta da IA está incompleta (faltam nome ou descricaoHtml).");
  }

  return parsed;
}
