"use client";

import { useState } from "react";
import { Card, Upload, Button, Typography, Space, Alert, Spin, Input, Tooltip, App } from "antd";
import { InboxOutlined, FileExcelOutlined, InfoCircleOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";
import { processFile, generateExcelFile } from "@/utils/fileProcessor";
import type { ProcessedData } from "@/utils/fileProcessor";

const { Title, Paragraph, Text, Link } = Typography;
const { Dragger } = Upload;
const { TextArea } = Input;

export default function Home() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [userStrings, setUserStrings] = useState<string>("");

  const { message } = App.useApp();

  const handleUpload = async () => {
    if (fileList.length === 0) return;

    setProcessing(true);
    try {
      const processedData: ProcessedData = {
        rendimentosTributaveisExclusiva: [],
        rendimentosIsentos: [],
        bensEDireitos: [],
      };

      const userStringsArray = userStrings
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean);

      for (const file of fileList) {
        if (file.originFileObj) {
          try {
            const result = await processFile(file.originFileObj, userStringsArray);
            (Object.keys(result) as Array<keyof ProcessedData>).forEach((key) => {
              if (result[key]) {
                processedData[key].push(...(result[key] || []));
              }
            });
          } catch (error) {
            console.error(`Error processing file ${file.name}:`, error);
            message.warning(`Não foi possível processar o arquivo ${file.name}. Verifique se o formato está correto.`);
          }
        }
      }

      const hasData = Object.values(processedData).some(array => array.length > 0);
      if (!hasData) {
        message.warning('Nenhum dado foi extraído dos arquivos. Verifique se os arquivos estão no formato correto ou se as strings para ofuscação não removeram dados importantes.');
        setProcessing(false);
        return;
      }

      const excelBlob = generateExcelFile(processedData);
      const url = window.URL.createObjectURL(excelBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'declaracao-irpf.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      message.success('Arquivos processados com sucesso!');
      setFileList([]);
    } catch (error) {
      console.error("Error processing files:", error);
      message.error('Erro ao processar arquivos. Por favor, tente novamente.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <Space direction="vertical" size="large" className="w-full">
        <Card>
          <Title level={3}>Pré-requisitos</Title>
          <ol className="list-decimal pl-6 mb-2">
            <li>
              Acesse o site do <Link href="https://registrato.bcb.gov.br/registrato/" target="_blank">Registrato</Link> e verifique todas as entidades em que você possui uma conta ativa.<br />
              <Text type="secondary">
                É necessário ter o 2FA habilitado e fazer o login através do gov.br. Após o login, acesse <b>Relatórios</b> e em seguida <b>CCS</b>.<br />
                <br />
              </Text>
            </li>
            <li>
              Acesse o site da <Link href="https://www.investidor.b3.com.br/" target="_blank">B3 (portal do investidor)</Link> para extrair os dados de negociações.<br />
              <Text type="secondary">
                <ol>
                  <li>
                    Clique em <b>Extrato</b>
                  </li>
                  <li>
                    Clique em <b>Negociações</b>
                  </li>
                  <li>
                    Clique em <b>Ver Resumo</b>
                  </li>
                  <li>
                    Filtre pelo período de interesse e clique em <b>Filtrar</b>
                  </li>
                  <li>
                    Clique em <b>Baixar</b> e escolha a opção <b>Arquivo em Excel para ser importado em planilhas</b>
                  </li>
                </ol>
              </Text>
            </li>
            <li>
            Acesse o site da <Link href="https://www.investidor.b3.com.br/" target="_blank">B3 (portal do investidor)</Link> para extrair o relatório consolidado do ano.<br />
              <Text type="secondary">
                <ol>
                  <li>
                    Clique em <b>Relatórios</b>
                  </li>
                  <li>
                    Clique em <b>Anual</b>
                  </li>
                  <li>
                    Selecione o ano de interesse
                  </li>
                  <li>
                    Clique em <b>Arquivo Excel</b>
                  </li>
                  <li>
                    Clique em <b>Baixar relatório</b>
                  </li>
                </ol>
              </Text>
            </li>
          </ol>
        </Card>

        <Card>
          <Title level={2}>IRParser</Title>
          <Paragraph>
            Este aplicativo ajuda você a preparar seus documentos para a declaração anual do Imposto de Renda. (Atualmente somente para as fichas de bens e direitos, rendimentos isentos e não tributáveis e rendimentos sujeitos a tributação exclusiva)
          </Paragraph>
          <Alert
            message="Importante"
            description={
              <>
                Este aplicativo processa seus documentos PDF e planilhas para extrair dados e gerar um arquivo Excel para sua declaração anual de imposto de renda. Para proteger sua privacidade, informações sensíveis como seu nome e CPF são removidas antes do processamento. Você também pode especificar termos adicionais (por exemplo, outros nomes, CNPJs pessoais, números de agência/conta bancária) para serem omitidos dos documentos, listando-os na caixa de ofuscação abaixo – certifique-se de que estejam escritos exatamente como aparecem em seus arquivos. Evite listar CNPJs de empresas ou FIIs aqui.
                <br />
                <br />
                <b>Aviso:</b> Nenhum arquivo enviado ou dado extraído é armazenado por este aplicativo.<br />
                <b>Aviso 2:</b> Quanto mais PDFs forem adicionados, mais tempo o processamento levará, em testes locais, um arquivo demorou cerca de 3 minutos para ser processado.
              </>
            }
            type="info"
            showIcon
            className="mb-8"
          />
          <div className="mb-8 mt-8">
            <Text strong>Termos a serem removidos (opcional):</Text>
            <Tooltip title="Informe nomes, CPFs, CNPJs pessoais, agências, contas, etc. Um por linha, exatamente como aparecem nos arquivos. Evite adicionar CNPJs de empresas ou FIIs aqui.">
              <InfoCircleOutlined style={{ marginLeft: 8 }} />
            </Tooltip>
            <TextArea
              rows={4}
              value={userStrings}
              onChange={e => setUserStrings(e.target.value)}
              placeholder={`Exemplo:
João da Silva
123.456.789-00
Agência 0001
Conta 12345-6`}
              className="mt-2"
            />
          </div>
          <Title level={4}>Arquivos Suportados</Title>
          <ul className="list-disc pl-6 mb-4">
            <li>Informe de rendimentos em PDF</li>
            <li>Planilhas da B3 (dividendos e negociações)</li>
          </ul>
        </Card>

        <Card>
          <Dragger
            multiple
            fileList={fileList}
            onChange={({ fileList }) => setFileList(fileList)}
            beforeUpload={() => false}
            accept=".pdf,.xlsx,.xls,.csv"
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">
              Clique ou arraste arquivos para esta área para fazer upload
            </p>
            <p className="ant-upload-hint">
              Suporta upload de múltiplos arquivos. Arquivos PDF, Excel e CSV são aceitos.
            </p>
          </Dragger>

          <div className="mt-4 flex justify-end">
            <Button
              type="primary"
              icon={<FileExcelOutlined />}
              onClick={handleUpload}
              disabled={fileList.length === 0 || processing}
            >
              {processing ? <Spin size="small" /> : "Processar Arquivos"}
            </Button>
          </div>
        </Card>
      </Space>
      <div className="mt-8">
        <strong>Essa ferramenta foi útil? Considere <Link href="https://buymeacoffee.com/tsubilhaga" target="_blank">comprar um café para mim! </Link>(coffee-in code-out)</strong>
      </div>
    </main>
  );
}
