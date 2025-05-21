interface CompanyInfo {
    name: string;
    cnpj: string | null;
    type: string;
  }
  
import b3CompaniesData from '../../b3_companies_and_fiis_details.json';

export const b3TickerMapping: Record<string, CompanyInfo> = b3CompaniesData;

// Função para obter informações da empresa a partir do ticker
export function getCompanyInfo(ticker: string): CompanyInfo | undefined {
  return b3TickerMapping[ticker];
}

// Função para validar se o ticker existe na lista de empresas da B3 que fizemos o crawler
export function isValidTicker(ticker: string): boolean {
  return ticker in b3TickerMapping;
} 