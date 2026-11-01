# IRParse

## Visão Geral

O IRParse é um projeto criado para auxiliar investidores brasileiros na preparação da declaração anual do Imposto de Renda, especialmente nas fichas de **Bens e Direitos**, **Rendimentos Isentos** e **Rendimentos Sujeitos à Tributação Exclusiva**. O objetivo é facilitar a coleta, organização e identificação dos ativos (ações e FIIs) negociados na B3, cruzando informações de tickers, nomes e CNPJs, para que o preenchimento da declaração seja mais simples, rápido e preciso.

## Scripts PowerShell

O projeto utiliza três scripts principais para coletar e organizar os dados necessários. A lógica comum deles fica em `b3_common.ps1`. Se uma página da B3 falhar, os scripts de lista param sem gravar um arquivo parcial.

### 1. `get_b3_fiis.ps1`
- **Função:** Realiza o crawler dos tickers de Fundos Imobiliários (FIIs) listados na B3.
- **Saída:** Gera o arquivo `b3_fiis_acronyms.txt` contendo todos os tickers de FIIs encontrados.

### 2. `get_b3_companies.ps1`
- **Função:** Realiza o crawler dos tickers de ações (empresas) listadas na B3.
- **Saída:** Gera o arquivo `b3_companies_cvm.txt` com todos os códigos CVM das empresas.

### 3. `get_b3_details.ps1`
- **Função:** Utiliza os arquivos gerados pelos scripts anteriores para buscar detalhes de cada ativo (nome da empresa/fundo, CNPJ, tipo).
- **Saída:** Gera o arquivo `b3_companies_and_fiis_details.json`, que consolida todas as informações relevantes para uso no frontend.

## Fluxo de Utilização

1. **Execute os scripts na seguinte ordem:**
   - Primeiro, rode `get_b3_companies.ps1` e `get_b3_fiis.ps1` para coletar os tickers.
   - Em seguida, rode `get_b3_details.ps1` para consolidar os dados em um único arquivo JSON.

2. **Integração com o Frontend:**
   - O arquivo `b3_companies_and_fiis_details.json` é importado diretamente por `src/utils/b3Mapping.ts`. Basta gerá-lo de novo para atualizar a base.
   - O frontend utiliza essas informações para validar tickers, buscar nomes e CNPJs automaticamente ao processar os arquivos do usuário.

3. **Processamento dos Dados do Usuário:**
   - O usuário faz upload dos informes de rendimentos em PDF e das planilhas da B3 (`.xlsx` ou `.xls`) pelo frontend.
   - O sistema cruza os dados dos arquivos enviados com o mapeamento de tickers, preenchendo automaticamente as informações necessárias para a declaração.

## Inicializando a Aplicação

Primeiro, instale as dependências com `npm install`. Esse comando também copia o worker do PDF.js para `public/`.

Para ler PDFs, crie um arquivo `.env.local` com as variáveis abaixo. Sem elas, as planilhas funcionam, mas os PDFs não são processados.

```bash
OPENROUTER_API_KEY=sua-chave
OPENROUTER_MODEL=id-do-modelo # veja https://openrouter.ai/models
```

Depois, rode o servidor de desenvolvimento:

```bash
npm run dev
# ou
yarn dev
# ou
pnpm dev
# ou
bun dev
```

Abra [http://localhost:3000](http://localhost:3000) no seu navegador para ver o resultado.

Você pode começar a editar a página modificando `src/app/page.tsx`. A página é atualizada automaticamente conforme você edita o arquivo.

## Testes

Rode `npm test`. O Vitest requer Node.js 22.12 ou mais recente.

## Boas Práticas de Contribuição

- Sempre abra uma issue para discutir novas funcionalidades ou correções antes de enviar um pull request.
- Teste os scripts e funcionalidades antes de submeter alterações.
- Sinta-se à vontade para sugerir melhorias, especialmente relacionadas à automação, performance ou cobertura de mais ativos.

## Observações Finais

- Os arquivos intermediários (`b3_fiis_acronyms.txt`, `b3_companies_cvm.txt`) são gerados pelos scripts e não são versionados.
- O arquivo final `b3_companies_and_fiis_details.json` é essencial para o funcionamento do frontend.
- As planilhas são lidas no navegador. O texto dos PDFs vai para um serviço de IA externo depois de uma remoção automática de dados pessoais, que pode falhar.
- A rota `/api/ai-extract` limita tamanho e origem, mas não o número de requisições. Em um site público, ligue esse limite na hospedagem.
- Os códigos fiscais e os valores devem ser conferidos no programa da Receita antes de declarar.
