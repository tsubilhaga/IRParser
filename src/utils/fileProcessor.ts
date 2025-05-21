
import * as XLSX from 'xlsx';
import { getCompanyInfo } from './b3Mapping';

export interface ProcessedDataObject {
  Ticker: string | null;
  CNPJ: string | null;
  'Nome da Empresa': string | null;
  Valor?: number | null;
  'Código': string | null;
  'Descrição': string | null;
  'Grupo': string | null;
  'Posição Ano Anterior': string | null;
  'Posição Atual': string | null;
  'Rendimentos': string | null;
}
// Interface das fichas integradas até o momento
export interface ProcessedData {
  rendimentosTributaveisExclusiva: ProcessedDataObject[];
  rendimentosIsentos: ProcessedDataObject[];
  bensEDireitos: ProcessedDataObject[];
}

export interface AIExtractor {
  extractIRPFData(cleanedText: string): Promise<ProcessedData>;
}

interface AssetTypeConfig {
  grupo: string;
  codigo: string;
}

// Constantes para classificar os ativos das planilhas da B3
const ASSET_TYPE_CONFIG: Record<string, AssetTypeConfig> = {
  'FII': { grupo: '7', codigo: '3' },
  'AÇÃO': { grupo: '3', codigo: '1' },
};

export class DefaultAIExtractor implements AIExtractor {
  async extractIRPFData(cleanedText: string): Promise<ProcessedData> {
    try {
      const response = await fetch('/api/ai-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanedText })
      });
      if (!response.ok) {
        return { rendimentosTributaveisExclusiva: [], rendimentosIsentos: [], bensEDireitos: [] };
      }
      const data = await response.json();

      if (data && data.results && typeof data.results === 'object') {
        const aiOutput = data.results;
        return {
          rendimentosTributaveisExclusiva: aiOutput.rendimentosTributaveisExclusiva || [],
          rendimentosIsentos: aiOutput.rendimentosIsentos || [],
          bensEDireitos: aiOutput.bensEDireitos || [],
        };
      }

      return { rendimentosTributaveisExclusiva: [], rendimentosIsentos: [], bensEDireitos: [] };
    } catch (error) {

      console.error("Error fetching or parsing AI data:", error);
      return { rendimentosTributaveisExclusiva: [], rendimentosIsentos: [], bensEDireitos: [] };
    }
  }
}

// Função para limpar informações pessoais do texto
export function cleanPII(text: string, userStringsToObfuscate?: string[]): string {
  
  text = text.replace(/^.*?(?:Nome completo?|Benefici[áa]rio|Cliente|Aplicações Financeiras| Contrato:)[\s:]*([^\s]+(?:\s[^\s]+)*?)(?:\s{2,}|\n|$)/gim, '[REMOVIDO]');
  text = text.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[REMOVIDO]');
  text = text.replace(/Ag[êe]ncia[\s:]*(\d*)[\s,;]/gi, '[REMOVIDO]');
  text = text.replace(/Conta[\s:]*(\d*)[\s,;]/gi, '[REMOVIDO]');
  text = text.replace(/Pessoa F[ií]sica benefici[áa]ria dos rendimentos:?\s*([^\s]+(?:\s[^\s]+)*?)(?:\s{2,}|\n|$)/gi, '[REMOVIDO]');
  
  if (userStringsToObfuscate && userStringsToObfuscate.length > 0) {
    for (const s of userStringsToObfuscate) {
      if (s && s.trim()) {
        const safe = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(safe, 'g');
        text = text.replace(re, '[REMOVIDO]');
      }
    }
  }

  return text;
}

export async function processFile(file: File, userStringsToObfuscate?: string[]): Promise<ProcessedData> {
  const fileType = file.name.split('.').pop()?.toLowerCase();
  
  if (fileType === 'pdf') {
    return processPDF(file, { saveCleanedText: false, userStringsToObfuscate });
  } else if (['xlsx', 'xls', 'csv'].includes(fileType || '')) {
    return processSpreadsheet(file);
  }
  
  throw new Error('Tipo de arquivo não suportado');
}

// Função para processar Informe de rendimentos em PDF
async function processPDF(
  file: File,
  options?: { saveCleanedText?: boolean; userStringsToObfuscate?: string[] }
): Promise<ProcessedData> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    // The items property exists but is not properly typed in the PDF.js types
    const items = (textContent as { items: Array<{ str: string }> }).items;
    fullText += items.map(item => item.str).join(' ') + '\n';
  }

  const cleanedText = cleanPII(fullText, options?.userStringsToObfuscate);

  if (options?.saveCleanedText) {
    const blob = new Blob([cleanedText], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name.replace(/\.pdf$/i, '') + '_cleaned.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    return {
      rendimentosTributaveisExclusiva: [],
      rendimentosIsentos: [],
      bensEDireitos: [],
    };
  }

  const extractor = new DefaultAIExtractor();
  const aiResult = await extractor.extractIRPFData(cleanedText);

  const result: ProcessedData = {
    rendimentosTributaveisExclusiva: aiResult.rendimentosTributaveisExclusiva,
    rendimentosIsentos: aiResult.rendimentosIsentos,
    bensEDireitos: aiResult.bensEDireitos,
  };

  return result;
}

// Função para processar planilhas da B3
async function processSpreadsheet(file: File): Promise<ProcessedData> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  const result: ProcessedData = {
    rendimentosTributaveisExclusiva: [],
    rendimentosIsentos: [],
    bensEDireitos: [],
  };

  // Função para obter informações (CNPJ) da empresa a partir do ticker
  const getInfo = (ticker: string) => {
  
    let info = getCompanyInfo(ticker);
    if (info) return info;

    // Caso o ticker não seja encontrado, tenta com o ticker sem o último caractere (pode acontecer para ações fracionadas)
    if (ticker?.length > 1) {
      info = getCompanyInfo(ticker.slice(0, -1));
      if (info) return info;
    }

    // Caso o ticker não seja encontrado, tenta com o ticker sem os dois últimos caracteres (pode acontecer para alguns tickers, não entendi bem o motivo mas é isso)
    if (ticker?.length > 2) {
      info = getCompanyInfo(ticker.slice(0, -2));
      if (info) return info;
    }

    return { name: '', cnpj: '', type: '' };
  };

  const negociacaoSheet = workbook.SheetNames.find(name => name.toLowerCase().includes('negoci'));
  if (negociacaoSheet) {
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[negociacaoSheet]);
    const grouped: Record<string, {
      years: Record<string, { buys: number[]; sells: number[]; buyQty: number; sellQty: number; }>;
      totalBuyQty: number;
      totalSellQty: number;
      totalBuys: number[];
      totalSells: number[];
    }> = {};

    for (const row of data) {
      const ticker = row['Código de Negociação'] || row['Código'] || row['Ticker'];
      if (!ticker) continue;
      
      const buyQty = Number(row['Quantidade (Compra)'] || 0);
      const sellQty = Number(row['Quantidade (Venda)'] || 0);
      
      const buyPrice = Number(row['Preço Médio (Compra)'] || 0);
      const sellPrice = Number(row['Preço Médio (Venda)'] || 0);
      
      const buyValue = buyQty * buyPrice;
      const sellValue = sellQty * sellPrice;
      
      const startDate = row['Período (Inicial)'];
      const year = startDate ? (() => {
        const [, , year] = startDate.split('/');
        return year;
      })() : 'Unknown';
      
      if (!grouped[ticker]) {
        grouped[ticker] = {
          years: {},
          totalBuyQty: 0,
          totalSellQty: 0,
          totalBuys: [],
          totalSells: []
        };
      }
      
      if (!grouped[ticker].years[year]) {
        grouped[ticker].years[year] = { buys: [], sells: [], buyQty: 0, sellQty: 0 };
      }

      if (buyQty > 0) {
        grouped[ticker].years[year].buys.push(buyValue);
        grouped[ticker].years[year].buyQty += buyQty;
        grouped[ticker].totalBuys.push(buyValue);
        grouped[ticker].totalBuyQty += buyQty;
      }

      if (sellQty > 0) {
        grouped[ticker].years[year].sells.push(sellValue);
        grouped[ticker].years[year].sellQty += sellQty;
        grouped[ticker].totalSells.push(sellValue);
        grouped[ticker].totalSellQty += sellQty;
      }
    }

    for (const ticker in grouped) {
      const info = getInfo(ticker);
      const tickerData = grouped[ticker];
      
      const yearlySummaries = Object.entries(tickerData.years)
        .sort(([yearA], [yearB]) => Number(yearA) - Number(yearB))
        .map(([year, data]) => {
          const buyAvg = data.buyQty ? data.buys.reduce((a, b) => a + b, 0) / data.buyQty : 0;
          const sellAvg = data.sellQty ? data.sells.reduce((a, b) => a + b, 0) / data.sellQty : 0;
          if (data.buyQty === 0 && data.sellQty === 0) return null;
          return `${year}: Compra ${data.buyQty} - Preço médio: R$${buyAvg.toFixed(2)} | Venda ${data.sellQty} - Preço médio: R$${sellAvg.toFixed(2)}`;
        })
        .filter(summary => summary !== null)
        .join('\n');

      const finalQty = tickerData.totalBuyQty - tickerData.totalSellQty;
      const finalBuyAvg = tickerData.totalBuyQty ? 
        tickerData.totalBuys.reduce((a, b) => a + b, 0) / tickerData.totalBuyQty : 0;

      const description = yearlySummaries 
        ? `${info.name}\nHistórico:\n${yearlySummaries}\nSaldo Final: ${finalQty} - Preço médio: R$${finalBuyAvg.toFixed(2)}`
        : `${info.name}\nSaldo Final: ${finalQty} - Preço médio: R$${finalBuyAvg.toFixed(2)}`;

      const assetConfig = ASSET_TYPE_CONFIG[info.type] || ASSET_TYPE_CONFIG['AÇÃO'];
      result.bensEDireitos?.push({
        Ticker: ticker,
        CNPJ: info.cnpj,
        'Nome da Empresa': info.name,
        'Descrição': description,
        'Grupo': assetConfig.grupo,
        'Código': assetConfig.codigo,
        "Posição Atual": (finalQty * finalBuyAvg).toString(),
        "Posição Ano Anterior": 'N/A',
        "Rendimentos": 'N/A',
      });
    }
  }

  const proventosSheet = workbook.SheetNames.find(name => name.toLowerCase().includes('provento'));
  if (proventosSheet) {
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[proventosSheet]);
    for (const row of data) {
      const produto = row['Produto'] || row['Ativo'] || row['Código'];
      const tipoEvento = (row['Tipo de Evento'] || '').toLowerCase();
      const valor = Number(row['Valor Líquido'] || row['Valor líquido'] || row['Valor'] || 0);
      const info = getInfo(produto);
      let categoria = '', codigo = '';
      if (tipoEvento.includes('dividendo')) {
        categoria = 'Rendimentos Isentos e Não Tributáveis';
        codigo = '9';
      } else if (tipoEvento.includes('rendimento')) {
        categoria = 'Rendimentos Sujeitos à Tributação Exclusiva';
        codigo = '6';
      } else if (tipoEvento.includes('juros sobre capital próprio') || tipoEvento.includes('jcp')) {
        categoria = 'Rendimentos Sujeitos à Tributação Exclusiva';
        codigo = '10';
      } else if (tipoEvento.includes('restituição de capital')) {
        categoria = 'Rendimentos Isentos e Não Tributáveis';
        codigo = '26';
      }
      if (categoria === 'Rendimentos Isentos e Não Tributáveis') {
        result.rendimentosIsentos?.push({
          Ticker: produto,
          CNPJ: info.cnpj || '',
          'Nome da Empresa': info.name,
          Valor: valor,
          'Código': codigo,
          'Descrição': 'N/A',
          'Grupo': 'N/A',
          'Posição Ano Anterior': 'N/A',
          'Posição Atual': 'N/A',
          'Rendimentos': 'N/A',
        });
      } else if (categoria === 'Rendimentos Sujeitos à Tributação Exclusiva') {
        result.rendimentosTributaveisExclusiva?.push({
          Ticker: produto,
          CNPJ: info.cnpj || '',
          'Nome da Empresa': info.name,
          Valor: valor,
          'Código': codigo,
          'Descrição': 'N/A',
          'Grupo': 'N/A',
          'Posição Ano Anterior': 'N/A',
          'Posição Atual': 'N/A',
          'Rendimentos': 'N/A',
        });
      }
    }
  }

  return result;
}

export function generateExcelFile(data: ProcessedData): Blob {
  const workbook = XLSX.utils.book_new();

  function toSheetWithColumns(rows: ProcessedDataObject[], columns: string[]) {
    const header = [columns];
    const body = rows.map(row => columns.map(col => {
      const value = row[col as keyof ProcessedDataObject];
      return value?.toString() ?? '';
    }));
    return XLSX.utils.aoa_to_sheet(header.concat(body));
  }

  if (data.bensEDireitos?.length > 0) {
    const columns = [
      'Ticker', 'CNPJ', 'Nome da Empresa', 'Descrição', 'Grupo', 'Código', 'Posição Atual', 'Posição Ano Anterior', 'Rendimentos'
    ];
    const ws = toSheetWithColumns(data.bensEDireitos, columns);
    XLSX.utils.book_append_sheet(workbook, ws, 'Bens e Direitos');
  }

  if (data.rendimentosIsentos?.length > 0) {
    const columns = [
      'Ticker', 'CNPJ', 'Nome da Empresa', 'Valor', 'Código', 'Descrição', 'Grupo', 'Posição Ano Anterior', 'Posição Atual', 'Rendimentos'
    ];
    const ws = toSheetWithColumns(data.rendimentosIsentos, columns);
    XLSX.utils.book_append_sheet(workbook, ws, 'Rendimentos Isentos');
  }

  if (data.rendimentosTributaveisExclusiva?.length > 0) {
    const columns = [
      'Ticker', 'CNPJ', 'Nome da Empresa', 'Valor', 'Código', 'Descrição', 'Grupo', 'Posição Ano Anterior', 'Posição Atual', 'Rendimentos'
    ];
    const ws = toSheetWithColumns(data.rendimentosTributaveisExclusiva, columns);
    XLSX.utils.book_append_sheet(workbook, ws, 'Rendimento Tributação Exclusiva');
  }

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
} 