import { NextRequest, NextResponse } from 'next/server';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL;
const MAX_BODY_LENGTH = 200_000;

const DEFAULT_PROMPT = `You are an expert at extracting structured data from Brazilian financial documents for tax declaration (IRPF). Extract the following categories from the provided text, grouping the data as needed:

IRPF Categories:
- Rendimentos Isentos (Ficha de Rendimentos Isentos)
- Rendimentos Sujeitos à Tributação Exclusiva (Ficha de Rendimentos Sujeitos à Tributação Exclusiva)
- Bens e Direitos (Ficha de Bens e Direitos, saldo em conta)

For each item in each category, extract the following fields (if available):
- Ticker (string, leave blank if not available)
- CNPJ (string)
- Nome da Empresa (string, source of payment or institution)
- Descrição (string, see below for details)
- Grupo (string, e.g., "07" for funds)
- Código (string, e.g., "03" for funds)
- Posição Atual (number, saldo no ano de interesse, use null if not available)
- Rendimentos (number, use null if not available)
- Posição Ano Anterior (number, use null if not available)

Special instructions for the "Descrição" field:
- Always include the product name (e.g., Fundo, CDB, RDB, LCI, LCA, CRA, CRI, tesouro direto, tesouro selic).
- Include the institution when it is available.

Output format:
Return only a single JSON object, with no extra text or comments, in the following format (inside a code block):

{
  "results": {
    "rendimentosIsentos": [
      {
        "Ticker": "",
        "CNPJ": "",
        "Nome da Empresa": "",
        "Descrição": "",
        "Grupo": "",
        "Código": "",
        "Posição Atual": null,
        "Rendimentos": null,
        "Posição Ano Anterior": null
      },
      {
        "Ticker": "",
        "CNPJ": "",
        "Nome da Empresa": "",
        "Descrição": "",
        "Grupo": "",
        "Código": "",
        "Posição Atual": null,
        "Rendimentos": null,
        "Posição Ano Anterior": null
      }
    ],
    "rendimentosTributaveisExclusiva": [
      {
        "Ticker": "",
        "CNPJ": "",
        "Nome da Empresa": "",
        "Descrição": "",
        "Grupo": "",
        "Código": "",
        "Posição Atual": null,
        "Rendimentos": null,
        "Posição Ano Anterior": null
      },
      {
        "Ticker": "",
        "CNPJ": "",
        "Nome da Empresa": "",
        "Descrição": "",
        "Grupo": "",
        "Código": "",
        "Posição Atual": null,
        "Rendimentos": null,
        "Posição Ano Anterior": null
      }
    ],
    "bensEDireitos": [
      {
        "Ticker": "",
        "CNPJ": "",
        "Nome da Empresa": "",
        "Descrição": "",
        "Grupo": "",
        "Código": "",
        "Posição Atual": null,
        "Rendimentos": null,
        "Posição Ano Anterior": null
      },
      {
        "Ticker": "",
        "CNPJ": "",
        "Nome da Empresa": "",
        "Descrição": "",
        "Grupo": "",
        "Código": "",
        "Posição Atual": null,
        "Rendimentos": null,
        "Posição Ano Anterior": null
      }
    ]
  }
}

Category assignment rules:
- If an item has both "Grupo" AND "Código", it likely belongs in "bensEDireitos" but you should check the context to be sure.
- If it has only "Código", it belongs in "rendimentosIsentos" or "rendimentosTributaveisExclusiva" (choose based on context).
- If a category has no data, omit it from the output.
- If a field is not available, use an empty string for text fields and null for numbers. Never use 0 for a value you did not find.

IMPORTANT:
- Only output the JSON, inside a code block, and nothing else.
- Do not include any explanations, comments, or text outside the JSON code block.

Examples:
- If you find: "Grupo: 07, Código: 03, Saldo: 1000", put it in "bensEDireitos".
- If you find: "Código: 06, Rendimentos: 500", put it in "rendimentosIsentos" or "rendimentosTributaveisExclusiva" as appropriate.

`;

function parseModelJson(content: string) {
  const answer = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  return JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1));
}

export async function POST(req: NextRequest) {
  // shortcut: um script pode forjar Origin, então isto só barra outros sites; limite requisições na hospedagem para um site público
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (req.headers.get('origin')?.replace(/^https?:\/\//, '') !== host) {
    return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  }

  if (!API_KEY || !MODEL) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY e OPENROUTER_MODEL precisam estar configuradas.' }, { status: 500 });
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: 'O texto enviado é grande demais.' }, { status: 413 });
  }

  let text: unknown;
  try {
    text = JSON.parse(rawBody).text;
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'Texto ausente na requisição.' }, { status: 400 });
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: DEFAULT_PROMPT },
          { role: 'user', content: text }
        ]
      })
    });

    if (!response.ok) {
      console.error('OpenRouter error:', response.status, await response.text());
      return NextResponse.json({ error: `O OpenRouter respondeu ${response.status}.` }, { status: 502 });
    }

    const result = await response.json();
    return NextResponse.json(parseModelJson(result.choices[0].message.content));
  } catch (error) {
    console.error('Error extracting data with AI:', error);
    return NextResponse.json({ error: 'A IA não devolveu uma resposta válida.' }, { status: 502 });
  }
}
