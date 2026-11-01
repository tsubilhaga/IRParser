import * as XLSX from 'xlsx';
import { getCompanyInfo } from './b3Mapping';

type CellValue = string | number | null;

export interface ProcessedDataObject {
  Ticker: string | null;
  CNPJ: string | null;
  'Nome da Empresa': string | null;
  Valor?: number | null;
  'Código': string | null;
  'Descrição': string | null;
  'Grupo': string | null;
  'Posição Ano Anterior': CellValue;
  'Posição Atual': CellValue;
  'Rendimentos': CellValue;
  Conferir?: string;
}

// Fichas integradas até o momento
export const FICHAS = ['rendimentosTributaveisExclusiva', 'rendimentosIsentos', 'bensEDireitos'] as const;
type Ficha = (typeof FICHAS)[number];

export type ProcessedData = Record<Ficha, ProcessedDataObject[]> & {
  // Avisos sem linha própria nas fichas, como eventos não incluídos
  avisos: string[];
};

export const emptyData = (): ProcessedData => ({
  rendimentosTributaveisExclusiva: [],
  rendimentosIsentos: [],
  bensEDireitos: [],
  avisos: [],
});

interface AssetTypeConfig {
  grupo: string;
  codigo: string;
}

// Constantes para classificar os ativos das planilhas da B3
const ASSET_TYPE_CONFIG: Record<string, AssetTypeConfig> = {
  'FII': { grupo: '7', codigo: '3' },
  'AÇÃO': { grupo: '3', codigo: '1' },
  'BDR': { grupo: '4', codigo: '4' },
};

const BDR_TICKER = /^[A-Z]{4}3[1-9]$/;
const CODIGO_ISENTO_OUTROS = '99';

function isValidCnpj(value: unknown): boolean {
  const cnpj = String(value ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(.)\1+$/.test(cnpj)) return false;
  const checkDigit = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      // O CNPJ alfanumérico usa o código ASCII do caractere menos 48
      sum += (cnpj.charCodeAt(i) - 48) * (((length - 1 - i) % 8) + 2);
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return checkDigit(12) === Number(cnpj[12]) && checkDigit(13) === Number(cnpj[13]);
}

function reviewAIRow(row: ProcessedDataObject, ficha: Ficha): ProcessedDataObject {
  const problems = ['Extraído por IA: confira com o informe'];
  if (!isValidCnpj(row.CNPJ)) problems.push('CNPJ inválido ou ausente');
  const fields = ficha === 'bensEDireitos' ? ['Posição Atual', 'Posição Ano Anterior'] as const : ['Rendimentos'] as const;
  for (const field of fields) {
    if (typeof row[field] !== 'number') problems.push(`${field} não encontrado`);
  }
  return { ...row, Conferir: problems.join('; ') };
}

export async function extractIRPFData(cleanedText: string): Promise<ProcessedData> {
  const response = await fetch('/api/ai-extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: cleanedText }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.results) {
    throw new Error(body?.error ?? `O serviço de IA respondeu ${response.status}.`);
  }

  const data = emptyData();
  for (const ficha of FICHAS) {
    const rows = body.results[ficha];
    if (Array.isArray(rows)) data[ficha] = rows.map(row => reviewAIRow(row, ficha));
  }
  return data;
}

const REMOVED = '[REMOVIDO]';
const NAME_LABEL = /(?<!\p{L})(?:pessoa f[ií]sica benefici[áa]ria dos rendimentos|nome(?: completo)?|benefici[áa]rio|cliente)(?!\p{L})[\s:.-]*/giu;
const NOT_A_NAME = /^(?:BANCO|BCO|CORRETORA|DTVM|CCTVM|CCVM|LTDA|FUNDO|FDO|FII|GRUPO|INVESTIMENTOS?|CPF|CNPJ|CDB|RDB|LCI|LCA|CRI|CRA)$/i;
const CPF = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;
// O lookahead preserva valores e datas, como "Conta Corrente 1.234,56"
const BANK_ACCOUNT = /(?<!\p{L})(?:ag[êe]ncia|ag\.|conta(?:\s+corrente|\s+poupan[çc]a)?|c\/c)[\s:nº°.-]*(?![\d.-]*[,/]\d)\d[\d.-]*[xX]?/giu;

function removeTerm(text: string, term: string): string {
  const pattern = term.trim().split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return text.replace(new RegExp(pattern, 'g'), REMOVED);
}

// Letras maiúsculas valem como nome com ou sem ":". Caixa normal só depois de ":",
// pois sem ele não dá para separar um nome de palavras como "Empresarial".
function nameAfterLabel(label: string, after: string): string | null {
  const isName = label.includes(':')
    ? (word: string) => /^[\p{Lu}'’]{2,}$/u.test(word) || /^\p{Lu}\p{Ll}+$/u.test(word) || /^(?:da|de|do|das|dos|e)$/.test(word)
    : (word: string) => /^[\p{Lu}'’]{2,}$/u.test(word);

  const name: string[] = [];
  for (const raw of after.trim().split(/\s+/)) {
    const word = raw.replace(/[,;:.]+$/, '');
    if (!isName(word) || NOT_A_NAME.test(word)) break;
    name.push(word);
    if (word !== raw) break;
  }
  while (name.length > 0 && /^(?:da|de|do|das|dos|e)$/.test(name[name.length - 1])) name.pop();
  return name.length >= 2 ? name.join(' ') : null;
}

// Função para limpar informações pessoais do texto
export function cleanPII(text: string, userStringsToObfuscate: string[] = []): string {
  const names = new Set<string>();
  for (const match of text.matchAll(NAME_LABEL)) {
    const start = match.index + match[0].length;
    const name = nameAfterLabel(match[0], text.slice(start, start + 200));
    if (name) names.add(name);
  }

  let cleaned = text.replace(CPF, REMOVED).replace(BANK_ACCOUNT, REMOVED);
  for (const term of [...names, ...userStringsToObfuscate]) {
    if (term.trim()) cleaned = removeTerm(cleaned, term);
  }
  return cleaned;
}

export async function processFile(file: File, userStringsToObfuscate?: string[]): Promise<ProcessedData> {
  const fileType = file.name.split('.').pop()?.toLowerCase();

  if (fileType === 'pdf') {
    return processPDF(file, userStringsToObfuscate);
  } else if (['xlsx', 'xls'].includes(fileType || '')) {
    return processSpreadsheet(file);
  }

  throw new Error('Tipo de arquivo não suportado');
}

// Função para processar Informe de rendimentos em PDF
async function processPDF(file: File, userStringsToObfuscate?: string[]): Promise<ProcessedData> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Copiado de node_modules no postinstall, para o PDF não passar por outro site
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map(item => ('str' in item ? item.str : '')).join(' ') + '\n';
  }

  if (!fullText.trim()) {
    throw new Error('O PDF não tem texto selecionável. Ele pode ser uma imagem digitalizada.');
  }

  return extractIRPFData(cleanPII(fullText, userStringsToObfuscate));
}

// Remove o nome em "PETR4 - PETROBRAS" e o "F" do mercado fracionário
const normalizeTicker = (raw: unknown): string =>
  String(raw ?? '').split(' - ')[0].trim().toUpperCase().replace(/^([A-Z0-9]{4}\d{1,2})F$/, '$1');

// Função para obter informações (CNPJ) da empresa a partir do ticker
function getInfo(ticker: string) {
  // Alguns tickers só existem na base sem os últimos caracteres
  return getCompanyInfo(ticker)
    ?? (ticker.length > 1 ? getCompanyInfo(ticker.slice(0, -1)) : undefined)
    ?? (ticker.length > 2 ? getCompanyInfo(ticker.slice(0, -2)) : undefined)
    ?? { name: '', cnpj: '', type: '' };
}

function assetProblems(info: { cnpj: string | null }, config: AssetTypeConfig | undefined): string[] {
  const problems: string[] = [];
  if (!config) problems.push('Tipo de ativo desconhecido: confira a ficha, o grupo e o código');
  if (!info.cnpj) problems.push('CNPJ não encontrado');
  return problems;
}

interface PeriodTotals {
  buyQty: number;
  buyValue: number;
  sellQty: number;
  sellValue: number;
}

function addTrade(periods: Map<string, PeriodTotals>, period: string, row: Record<string, string>) {
  const buyQty = Number(row['Quantidade (Compra)'] || 0);
  const sellQty = Number(row['Quantidade (Venda)'] || 0);
  const totals = periods.get(period) ?? { buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0 };
  if (buyQty > 0) {
    totals.buyQty += buyQty;
    totals.buyValue += buyQty * Number(row['Preço Médio (Compra)'] || 0);
  }
  if (sellQty > 0) {
    totals.sellQty += sellQty;
    totals.sellValue += sellQty * Number(row['Preço Médio (Venda)'] || 0);
  }
  periods.set(period, totals);
}

// shortcut: ignora bonificação, desdobramento e custos, que a aba de negociações não traz; usar o relatório de eventos da B3 para cobri-los
function buildPosition(ticker: string, periods: Map<string, PeriodTotals>): ProcessedDataObject {
  const info = getInfo(ticker);
  const config = BDR_TICKER.test(ticker) ? ASSET_TYPE_CONFIG['BDR'] : ASSET_TYPE_CONFIG[info.type];
  const problems = assetProblems(info, config);

  let quantity = 0;
  let averagePrice = 0;
  let missingHistory = false;
  let sharedPeriod = false;
  const years = new Map<string, PeriodTotals>();

  for (const [period, totals] of [...periods].sort(([a], [b]) => a.localeCompare(b))) {
    // Dentro de um período a ordem é desconhecida: a compra entra antes da venda
    if (totals.buyQty > 0 && totals.sellQty > 0) sharedPeriod = true;
    if (totals.buyQty > 0) {
      averagePrice = (quantity * averagePrice + totals.buyValue) / (quantity + totals.buyQty);
      quantity += totals.buyQty;
    }
    if (totals.sellQty > 0) {
      quantity -= totals.sellQty;
      if (quantity < 0) {
        missingHistory = true;
        quantity = 0;
      }
    }

    const year = period.slice(0, 4) || 'Sem data';
    const yearTotals = years.get(year) ?? { buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0 };
    yearTotals.buyQty += totals.buyQty;
    yearTotals.buyValue += totals.buyValue;
    yearTotals.sellQty += totals.sellQty;
    yearTotals.sellValue += totals.sellValue;
    years.set(year, yearTotals);
  }

  if (missingHistory) problems.push('Histórico incompleto: há mais vendas que compras no período enviado');
  if (sharedPeriod) problems.push('Compra e venda no mesmo período: o preço médio pode mudar conforme a ordem real');
  if (periods.has('')) problems.push('Linha sem data: a ordem das operações não é garantida');

  const average = (value: number, qty: number) => (qty ? value / qty : 0).toFixed(2);
  const history = [...years]
    .filter(([, t]) => t.buyQty > 0 || t.sellQty > 0)
    .map(([year, t]) => `${year}: Compra ${t.buyQty} - Preço médio: R$${average(t.buyValue, t.buyQty)} | Venda ${t.sellQty} - Preço médio: R$${average(t.sellValue, t.sellQty)}`)
    .join('\n');
  const balance = missingHistory
    ? 'Saldo Final: histórico incompleto'
    : `Saldo Final: ${quantity} - Preço médio: R$${averagePrice.toFixed(2)}`;

  return {
    Ticker: ticker,
    CNPJ: info.cnpj,
    'Nome da Empresa': info.name,
    'Descrição': history ? `${info.name}\nHistórico:\n${history}\n${balance}` : `${info.name}\n${balance}`,
    'Grupo': config?.grupo ?? '',
    'Código': config?.codigo ?? '',
    'Posição Atual': missingHistory ? 'N/A' : (quantity * averagePrice).toFixed(2),
    'Posição Ano Anterior': 'N/A',
    'Rendimentos': 'N/A',
    Conferir: problems.join('; ') || undefined,
  };
}

function classifyPayment(event: string, assetType: string): { ficha: Ficha; codigo: string } | null {
  if (event.includes('dividendo')) return { ficha: 'rendimentosIsentos', codigo: '9' };
  if (event.includes('rendimento')) {
    return assetType === 'FII'
      ? { ficha: 'rendimentosIsentos', codigo: CODIGO_ISENTO_OUTROS }
      : { ficha: 'rendimentosTributaveisExclusiva', codigo: '6' };
  }
  if (event.includes('juros sobre capital próprio') || event.includes('jcp')) {
    return { ficha: 'rendimentosTributaveisExclusiva', codigo: '10' };
  }
  if (event.includes('restituição de capital')) return { ficha: 'rendimentosIsentos', codigo: CODIGO_ISENTO_OUTROS };
  return null;
}

// Função para processar planilhas da B3
async function processSpreadsheet(file: File): Promise<ProcessedData> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const result = emptyData();

  const negociacaoSheet = workbook.SheetNames.find(name => name.toLowerCase().includes('negoci'));
  if (negociacaoSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[negociacaoSheet]);
    const tickers = new Map<string, Map<string, PeriodTotals>>();

    for (const row of rows) {
      const ticker = normalizeTicker(row['Código de Negociação'] || row['Código'] || row['Ticker']);
      if (!ticker) continue;
      const date = String(row['Período (Inicial)'] ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      const period = date ? `${date[3]}-${date[2]}-${date[1]}` : '';
      if (!tickers.has(ticker)) tickers.set(ticker, new Map());
      addTrade(tickers.get(ticker)!, period, row);
    }

    for (const [ticker, periods] of tickers) {
      result.bensEDireitos.push(buildPosition(ticker, periods));
    }
  }

  const proventosSheet = workbook.SheetNames.find(name => name.toLowerCase().includes('provento'));
  if (proventosSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[proventosSheet]);
    const payments = new Map<string, ProcessedDataObject>();

    for (const row of rows) {
      const ticker = normalizeTicker(row['Produto'] || row['Ativo'] || row['Código']);
      if (!ticker) continue;
      const event = row['Tipo de Evento'] || '';
      const value = Number(row['Valor Líquido'] || row['Valor líquido'] || row['Valor'] || 0);
      const info = getInfo(ticker);

      if (BDR_TICKER.test(ticker)) {
        result.avisos.push(`${ticker}: ${event} de R$ ${value.toFixed(2)} não incluído. Provento de BDR não segue a regra de ações: declare à parte.`);
        continue;
      }
      const placement = classifyPayment(event.toLowerCase(), info.type);
      if (!placement) {
        result.avisos.push(`${ticker}: evento "${event}" de R$ ${value.toFixed(2)} não incluído. Verifique como declarar.`);
        continue;
      }

      // A declaração pede uma linha por pagador e código
      const key = `${placement.ficha}|${info.cnpj || ticker}|${placement.codigo}`;
      const existing = payments.get(key);
      if (existing) {
        existing.Valor = Math.round(((existing.Valor ?? 0) + value) * 100) / 100;
        if (!existing.Ticker?.split(', ').includes(ticker)) existing.Ticker += `, ${ticker}`;
        continue;
      }
      const entry: ProcessedDataObject = {
        Ticker: ticker,
        CNPJ: info.cnpj || '',
        'Nome da Empresa': info.name,
        Valor: value,
        'Código': placement.codigo,
        'Descrição': 'N/A',
        'Grupo': 'N/A',
        'Posição Ano Anterior': 'N/A',
        'Posição Atual': 'N/A',
        'Rendimentos': 'N/A',
        Conferir: assetProblems(info, ASSET_TYPE_CONFIG[info.type]).join('; ') || undefined,
      };
      payments.set(key, entry);
      result[placement.ficha].push(entry);
    }
  }

  return result;
}

const BENS_COLUMNS = ['Ticker', 'CNPJ', 'Nome da Empresa', 'Descrição', 'Grupo', 'Código', 'Posição Atual', 'Posição Ano Anterior', 'Rendimentos', 'Conferir'];
const RENDIMENTOS_COLUMNS = ['Ticker', 'CNPJ', 'Nome da Empresa', 'Valor', 'Código', 'Descrição', 'Grupo', 'Posição Ano Anterior', 'Posição Atual', 'Rendimentos', 'Conferir'];

export function generateExcelFile(data: ProcessedData): Blob {
  const workbook = XLSX.utils.book_new();

  const addSheet = (name: string, rows: ProcessedDataObject[], columns: string[]) => {
    if (rows.length === 0) return;
    const body = rows.map(row => columns.map(col => row[col as keyof ProcessedDataObject]?.toString() ?? ''));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([columns, ...body]), name);
  };

  addSheet('Bens e Direitos', data.bensEDireitos, BENS_COLUMNS);
  addSheet('Rendimentos Isentos', data.rendimentosIsentos, RENDIMENTOS_COLUMNS);
  addSheet('Rendimento Tributação Exclusiva', data.rendimentosTributaveisExclusiva, RENDIMENTOS_COLUMNS);
  if (data.avisos.length > 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Aviso'], ...data.avisos.map(aviso => [aviso])]), 'Avisos');
  }

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
