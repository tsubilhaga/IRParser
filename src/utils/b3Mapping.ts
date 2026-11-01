import b3Details from '../../b3_companies_and_fiis_details.json';

interface CompanyInfo {
  name: string;
  cnpj: string | null;
  type: string;
}

const b3TickerMapping: Record<string, CompanyInfo> = b3Details;

// Função para obter informações da empresa a partir do ticker
export function getCompanyInfo(ticker: string): CompanyInfo | undefined {
  return Object.hasOwn(b3TickerMapping, ticker) ? b3TickerMapping[ticker] : undefined;
}
