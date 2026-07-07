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
import { ENV } from "../_core/env";

// ---------- SKU + slug ----------

const slugOpts = { lower: true, strict: true, locale: "pt", trim: true };

export function buildSlug(nome: string): string {
  return slugify(nome, slugOpts);
}

/**
 * SKU compacto: `QTK - 001 - ABS - APC - 01`.
 * O nome do produto NÃO entra no SKU (fica no campo "Nome do produto");
 * isso mantém Modelo/Referência curtos o bastante pra todos os campos
 * do painel da Tray e não trunca em listagens.
 *
 * `args.nome` é mantido na assinatura por compat — não é usado no SKU.
 */
export function buildSku(args: {
  cat3: string;
  sub3?: string;
  seq: number;
  variant?: number;
  nome?: string;
}): string {
  const sub3 = (args.sub3 || args.cat3).toUpperCase().padEnd(3, "X").slice(0, 3);
  const cat3 = args.cat3.toUpperCase().padEnd(3, "X").slice(0, 3);
  const seq = String(args.seq).padStart(3, "0");
  const variant = String(args.variant ?? 1).padStart(2, "0");
  return `QTK - ${seq} - ${cat3} - ${sub3} - ${variant}`;
}

// ---------- IA: análise de uma imagem ----------

export type AiSuggestion = {
  nome: string;
  descricaoHtml: string;
  potencialVenda: number; // 1..10
  palavrasChave: string[];
  publicoAlvo: string;
};

// Schema usado pelo Gemini via responseSchema (não suporta `additionalProperties`).
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    nome: { type: "string" },
    descricaoHtml: { type: "string" },
    potencialVenda: { type: "integer" },
    palavrasChave: { type: "array", items: { type: "string" } },
    publicoAlvo: { type: "string" },
  },
  required: ["nome", "descricaoHtml", "potencialVenda", "palavrasChave", "publicoAlvo"],
} as const;

const PROMPT_SISTEMA = `Você é um especialista em SEO e curadoria para e-commerce de quadros decorativos da marca Qtok Quadros.

Sua função: receber UMA imagem de arte (do banco do fabricante) e produzir os metadados comerciais para cadastro na Tray.

Regras inegociáveis:
- Escreva 100% em português brasileiro.
- O nome do produto começa com "Quadro " (sem a palavra "Decorativo"). Exemplo: "Quadro Panda Bebê Fofo no Jardim".
- A descrição é HTML puro (sem \\\`\\\`\\\`html, sem markdown), no template abaixo, preenchendo APENAS os trechos entre {{}}.
- O "potencialVenda" deve refletir honestamente quão comercial a arte é: 10 = best-seller óbvio, 1 = arte interessante mas nichada demais.
- Não invente dimensões, materiais, preços ou prazos — esses campos são preenchidos por outro sistema.
- Se receber uma lista de "nomes já usados", o "nome" gerado NÃO pode ser igual (nem uma variação trivial) a nenhum item dessa lista — crie um nome diferente para a mesma categoria.

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

function extractInlineData(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("imageDataUrl inválido: precisa ser data:<mime>;base64,<...>");
  return { mimeType: match[1], data: match[2] };
}

/**
 * Analisa uma imagem do banco e devolve metadados estruturados para cadastro.
 * Chama a Gemini API diretamente (generativelanguage.googleapis.com) usando
 * GOOGLE_API_KEY — a mesma chave usada pelo gerador de imagens existente.
 */
export async function analyzeImageForCatalog(args: {
  imageDataUrl: string;
  categoria: string;
  fileName: string;
  existingNames?: string[];
}): Promise<AiSuggestion> {
  if (!ENV.googleApiKey) {
    throw new Error("GOOGLE_API_KEY não configurada");
  }

  const { mimeType, data } = extractInlineData(args.imageDataUrl);
  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${ENV.googleApiKey}`;

  const excludedNamesText =
    args.existingNames && args.existingNames.length > 0
      ? `\n\nNomes já usados nesta categoria — NÃO repita nenhum deles, crie um nome diferente: ${args.existingNames.join("; ")}`
      : "";
  const userText = `Categoria do banco: "${args.categoria}". Arquivo de origem: "${args.fileName}". Analise a imagem e gere os metadados conforme as instruções.${excludedNamesText}`;

  const payload = {
    systemInstruction: { parts: [{ text: PROMPT_SISTEMA }] },
    contents: [
      {
        role: "user",
        parts: [{ inlineData: { mimeType, data } }, { text: userText }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.7,
      // 2048 cortava a descrição HTML no meio em ~30% das chamadas;
      // 8192 dá folga pro template completo (h2 + 3× h3 + ul de 4 items).
      maxOutputTokens: 8192,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API erro ${response.status}: ${errText.slice(0, 300)}`);
  }

  const result = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = result.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? "";
  if (!text) {
    throw new Error("Gemini não retornou texto na análise da imagem.");
  }

  let parsed: AiSuggestion;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Resposta Gemini não é JSON válido: ${text.slice(0, 200)}`);
  }

  if (!parsed.nome || !parsed.descricaoHtml) {
    throw new Error("Resposta da IA está incompleta (faltam nome ou descricaoHtml).");
  }

  return parsed;
}
