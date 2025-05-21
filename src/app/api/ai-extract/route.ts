import { NextRequest, NextResponse } from 'next/server';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = process.env.OPENROUTER_API_KEY;

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
- Posição Atual (number, saldo no ano de interesse, use 0.0 if not available)
- Rendimentos (number, use 0.0 if not available)
- Posição Ano Anterior (number, use 0.0 if not available)

Special instructions for the "Descrição" field:
- Always include the product name (e.g., Fundo, CDB, RDB, LCI, LCA, CRA, CRI, tesouro direto, tesouro selic).
- If you find a sequence of 9, 8, or 7 digits, treat it as a possible account number and include it in the description.
- If you find a sequence of 4 digits, treat it as a possible agency number and include it in the description.
- If both are found, include both in the description, along with the product name and institution.

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
        "Posição Atual": 0.0,
        "Rendimentos": 0.0,
        "Posição Ano Anterior": 0.0
      },
      {
        "Ticker": "",
        "CNPJ": "",
        "Nome da Empresa": "",
        "Descrição": "",
        "Grupo": "",
        "Código": "",
        "Posição Atual": 0.0,
        "Rendimentos": 0.0,
        "Posição Ano Anterior": 0.0
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
        "Posição Atual": 0.0,
        "Rendimentos": 0.0,
        "Posição Ano Anterior": 0.0
      },
      {
        "Ticker": "",
        "CNPJ": "",
        "Nome da Empresa": "",
        "Descrição": "",
        "Grupo": "",
        "Código": "",
        "Posição Atual": 0.0,
        "Rendimentos": 0.0,
        "Posição Ano Anterior": 0.0
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
        "Posição Atual": 0.0,
        "Rendimentos": 0.0,
        "Posição Ano Anterior": 0.0
      },
      {
        "Ticker": "",
        "CNPJ": "",
        "Nome da Empresa": "",
        "Descrição": "",
        "Grupo": "",
        "Código": "",
        "Posição Atual": 0.0,
        "Rendimentos": 0.0,
        "Posição Ano Anterior": 0.0
      }
    ]
  }
}

Category assignment rules:
- If an item has both "Grupo" AND "Código", it likely belongs in "bensEDireitos" but you should check the context to be sure.
- If it has only "Código", it belongs in "rendimentosIsentos" or "rendimentosTributaveisExclusiva" (choose based on context).
- If a category has no data, omit it from the output.
- If a field is not available, use an empty string for text fields and 0.0 for numbers.

IMPORTANT:
- Only output the JSON, inside a code block, and nothing else.
- Do not include any explanations, comments, or text outside the JSON code block.

Examples:
- If you find: "Grupo: 07, Código: 03, Saldo: 1000", put it in "bensEDireitos".
- If you find: "Código: 06, Rendimentos: 500", put it in "rendimentosIsentos" or "rendimentosTributaveisExclusiva" as appropriate.
- If you find "Conta: 123456789, Agência: 1234", include both in the "Descrição" field.

`;

export async function POST(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json({ error: 'API key not configured.' }, { status: 500 });
  }

  const { text } = await req.json();
  if (!text) {
    return NextResponse.json({ error: 'Missing text in request body.' }, { status: 400 });
  }

  const messages = [
    { role: 'system', content: DEFAULT_PROMPT },
    { role: 'user', content: text }
  ];

  const data = {
    model: 'microsoft/mai-ds-r1:free',
    messages
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch data from OpenRouter API.' }, { status: response.status });
    }

    const result = await response.json();

    let aiJson = null;
    try {
      const content = result.choices?.[0]?.message?.content;
      aiJson = JSON.parse(content.replace(/```json\n/, '').replace(/\n```/, ''));
    } catch (e) {
      console.error('Error parsing AI response:', e);
      aiJson = { error: 'Failed to parse AI response as JSON.', raw: result };
    }
    return NextResponse.json(aiJson);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error.', details: error }, { status: 500 });
  }
}
