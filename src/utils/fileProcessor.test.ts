import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { cleanPII, extractIRPFData, generateExcelFile, processFile } from './fileProcessor';

type Row = Record<string, string | number>;

function workbookFile(sheets: Record<string, Row[]>): File {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
  }
  return new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'b3.xlsx');
}

const trade = (ticker: string, year: number, buyQty: number, buyPrice: number, sellQty = 0, sellPrice = 0): Row => ({
  'Código de Negociação': ticker,
  'Período (Inicial)': `01/01/${year}`,
  'Quantidade (Compra)': buyQty,
  'Preço Médio (Compra)': buyPrice,
  'Quantidade (Venda)': sellQty,
  'Preço Médio (Venda)': sellPrice,
});

const payment = (produto: string, evento: string, valor: number): Row => ({
  Produto: produto,
  'Tipo de Evento': evento,
  'Valor líquido': valor,
});

const trades = (rows: Row[]) => processFile(workbookFile({ Negociacao: rows }));
const payments = (rows: Row[]) => processFile(workbookFile({ 'Proventos Recebidos': rows }));

describe('proventos', () => {
  it('declara rendimento de FII como isento', async () => {
    const result = await payments([payment('HGLG11', 'Rendimento', 100)]);
    expect(result.rendimentosTributaveisExclusiva).toEqual([]);
    expect(result.rendimentosIsentos[0]).toMatchObject({ Ticker: 'HGLG11', 'Código': '99', Valor: 100 });
  });

  it('pede conferência de rendimento de ativo desconhecido', async () => {
    const result = await payments([payment('BOVA11', 'Rendimento', 10)]);
    expect(result.rendimentosTributaveisExclusiva[0].Conferir).toMatch(/tipo/i);
  });

  it('mantém dividendo isento e JCP na tributação exclusiva', async () => {
    const result = await payments([
      payment('PETR4', 'Dividendo', 50),
      payment('PETR4', 'Juros Sobre Capital Próprio', 20),
    ]);
    expect(result.rendimentosIsentos[0]).toMatchObject({ 'Código': '9', Valor: 50 });
    expect(result.rendimentosTributaveisExclusiva[0]).toMatchObject({ 'Código': '10', Valor: 20 });
  });

  it('soma pagamentos do mesmo pagador e código', async () => {
    const result = await payments([
      payment('PETR4', 'Dividendo', 50.1),
      payment('PETR4', 'Dividendo', 0.2),
      payment('PETR3', 'Dividendo', 10),
    ]);
    expect(result.rendimentosIsentos).toHaveLength(1);
    expect(result.rendimentosIsentos[0]).toMatchObject({ Ticker: 'PETR4, PETR3', Valor: 60.3 });
  });

  it('entende produto no formato "TICKER - NOME"', async () => {
    const result = await payments([payment('PETR4 - PETROBRAS', 'Dividendo', 5)]);
    expect(result.rendimentosIsentos[0]).toMatchObject({ Ticker: 'PETR4', CNPJ: '33000167000101' });
  });

  it('avisa sobre evento que não sabe classificar', async () => {
    const result = await payments([payment('VALE3', 'Amortização', 30)]);
    expect(result.avisos.join()).toMatch(/VALE3.*Amortização.*30/);
  });

  it('não declara dividendo de BDR como isento', async () => {
    const result = await payments([payment('AAPL34', 'Dividendo', 12)]);
    expect(result.rendimentosIsentos).toEqual([]);
    expect(result.avisos.join()).toMatch(/AAPL34/);
  });
});

describe('posição em bens e direitos', () => {
  it('recalcula o preço médio depois de zerar a posição', async () => {
    const result = await trades([trade('PETR4', 2023, 100, 10), trade('PETR4', 2024, 0, 0, 100, 15), trade('PETR4', 2025, 100, 20)]);
    expect(result.bensEDireitos[0]['Posição Atual']).toBe('2000.00');
  });

  it('calcula em ordem de data mesmo com linhas fora de ordem', async () => {
    const result = await trades([trade('PETR4', 2025, 100, 20), trade('PETR4', 2024, 0, 0, 100, 15), trade('PETR4', 2023, 100, 10)]);
    expect(result.bensEDireitos[0]['Posição Atual']).toBe('2000.00');
  });

  it('venda não altera o preço médio', async () => {
    const result = await trades([trade('PETR4', 2024, 100, 10), trade('PETR4', 2025, 0, 0, 40, 99)]);
    expect(result.bensEDireitos[0]['Posição Atual']).toBe('600.00');
  });

  it('junta o mercado fracionário ao ticker normal', async () => {
    const result = await trades([trade('PETR4', 2025, 100, 30), trade('PETR4F', 2025, 50, 30)]);
    expect(result.bensEDireitos).toHaveLength(1);
    expect(result.bensEDireitos[0]).toMatchObject({ Ticker: 'PETR4', 'Posição Atual': '4500.00' });
  });

  it('não inventa posição quando falta histórico de compra', async () => {
    const result = await trades([trade('VALE3', 2025, 0, 0, 50, 60)]);
    expect(result.bensEDireitos[0]['Posição Atual']).toBe('N/A');
    expect(result.bensEDireitos[0].Conferir).toMatch(/histórico/i);
  });

  it('pede conferência quando compra e venda caem no mesmo período', async () => {
    const result = await trades([trade('PETR4', 2025, 100, 10, 10, 12)]);
    expect(result.bensEDireitos[0].Conferir).toMatch(/mesmo período/i);
  });

  it('classifica FII e ação', async () => {
    const result = await trades([trade('HGLG11', 2025, 1, 100), trade('PETR4', 2025, 1, 30)]);
    expect(result.bensEDireitos[0]).toMatchObject({ Grupo: '7', 'Código': '3' });
    expect(result.bensEDireitos[1]).toMatchObject({ Grupo: '3', 'Código': '1' });
    expect(result.bensEDireitos[1].Conferir).toBeFalsy();
  });

  it('não chama ativo desconhecido de ação', async () => {
    const result = await trades([trade('BOVA11', 2025, 10, 100)]);
    expect(result.bensEDireitos[0]).toMatchObject({ Grupo: '', 'Código': '' });
    expect(result.bensEDireitos[0].Conferir).toMatch(/tipo/i);
  });

  it('classifica BDR no grupo 4, código 4', async () => {
    const known = await trades([trade('BMTU39', 2025, 1, 50)]);
    expect(known.bensEDireitos[0]).toMatchObject({ Grupo: '4', 'Código': '4' });
    expect(known.bensEDireitos[0].Conferir).toMatch(/CNPJ/);
    const missing = await trades([trade('AAPL34', 2025, 1, 50)]);
    expect(missing.bensEDireitos[0]).toMatchObject({ Grupo: '4', 'Código': '4' });
  });
});

describe('arquivos', () => {
  it('recusa CSV em vez de devolver vazio', async () => {
    await expect(processFile(new File(['a,b\n1,2\n'], 'b3.csv'))).rejects.toThrow(/não suportado/);
  });

  it('leva a coluna Conferir e a aba Avisos para o Excel', async () => {
    const data = await payments([payment('BOVA11', 'Rendimento', 10), payment('VALE3', 'Amortização', 30)]);
    const workbook = XLSX.read(await generateExcelFile(data).arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets['Rendimento Tributação Exclusiva']);
    expect(rows[0].Conferir).toMatch(/tipo/i);
    expect(workbook.SheetNames).toContain('Avisos');
  });
});

describe('cleanPII', () => {
  it.each([
    ['CPF sem pontuação', 'CPF: 12345678900 Saldo 1000', '12345678900'],
    ['CPF com pontuação', 'CPF 123.456.789-00 Saldo 1000', '123.456.789-00'],
    ['conta com dígito', 'Conta 12345-6 Saldo', '12345-6'],
    ['conta corrente', 'Conta Corrente: 987654321 Saldo', '987654321'],
    ['agência com dígito', 'Agência 0001-2 Saldo', '0001-2'],
    ['nome após "Nome:"', 'Nome: JOAO DA SILVA Saldo 1000', 'JOAO DA SILVA'],
    ['nome em caixa normal', 'Nome: João da Silva CPF', 'João da Silva'],
    ['nome após "Cliente"', 'Cliente JOAO SILVA Rendimentos 300,00', 'JOAO SILVA'],
  ])('remove %s', (_label, input, secret) => {
    expect(cleanPII(input)).not.toContain(secret);
  });

  it('remove o nome também onde ele aparece sem rótulo', () => {
    expect(cleanPII('Cliente JOAO SILVA  Extrato de JOAO  SILVA')).not.toMatch(/JOAO/);
  });

  it.each([
    ['linha com cliente', 'Banco X CNPJ 11.222.333/0001-81 Saldo em 31/12 R$ 5.000,00 Cliente JOAO SILVA Rendimentos 300,00 CDB 2000,00', ['11.222.333/0001-81', '5.000,00', '300,00', '2000,00', 'CDB']],
    ['título da seção', 'Banco X Saldo R$ 5.000,00  Aplicações Financeiras  CDB 2000,00  LCI 3000,00', ['5.000,00', 'CDB 2000,00', 'LCI 3000,00']],
    ['valor grande', 'Saldo 123.456.789,00', ['123.456.789,00']],
    ['CNPJ sem pontuação', 'CNPJ 11222333000181', ['11222333000181']],
    ['empresa pagadora', 'Nome Empresarial BANCO XP S.A. Nome: BANCO XP S.A. Saldo', ['BANCO XP S.A.']],
    ['produto depois de rótulo', 'Cliente CDB 2000,00', ['CDB 2000,00']],
    ['saldo em conta', 'Saldo em Conta Corrente 1.234,56 em Conta 31/12/2025', ['1.234,56', '31/12/2025']],
  ])('preserva dados financeiros: %s', (_label, input, kept) => {
    const output = cleanPII(input);
    for (const value of kept) expect(output).toContain(value);
  });

  it('remove termos informados, tolerando espaços', () => {
    expect(cleanPII('Extrato de Fulano   de Tal', ['Fulano de Tal'])).toBe('Extrato de [REMOVIDO]');
  });
});

describe('extractIRPFData', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status }));

  it('lança erro com o motivo quando a API falha', async () => {
    respond(502, { error: 'OpenRouter respondeu 404' });
    await expect(extractIRPFData('x')).rejects.toThrow('OpenRouter respondeu 404');
  });

  it('lança erro quando a resposta não tem resultados', async () => {
    respond(200, { nada: true });
    await expect(extractIRPFData('x')).rejects.toThrow();
  });

  it('aceita CNPJ alfanumérico válido', async () => {
    respond(200, { results: { rendimentosIsentos: [{ CNPJ: '12.ABC.345/01DE-35', Rendimentos: 1 }] } });
    expect((await extractIRPFData('x')).rendimentosIsentos[0].Conferir).not.toMatch(/CNPJ/);
  });

  it('marca toda linha da IA para conferência e aponta problemas', async () => {
    respond(200, {
      results: {
        bensEDireitos: [
          { Ticker: '', CNPJ: '11.222.333/0001-81', 'Posição Atual': 10, 'Posição Ano Anterior': 5, Rendimentos: 1 },
          { Ticker: '', CNPJ: '11.222.333/0001-82', 'Posição Atual': null, 'Posição Ano Anterior': 5, Rendimentos: 1 },
        ],
        rendimentosIsentos: 'inválido',
      },
    });
    const result = await extractIRPFData('x');
    expect(result.rendimentosIsentos).toEqual([]);
    expect(result.bensEDireitos[0].Conferir).toMatch(/IA/);
    expect(result.bensEDireitos[0].Conferir).not.toMatch(/CNPJ/);
    expect(result.bensEDireitos[1].Conferir).toMatch(/CNPJ inválido/);
    expect(result.bensEDireitos[1].Conferir).toMatch(/Posição Atual/);
  });
});
