import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ConfigProvider, App as AntdApp } from "antd";
import ptBR from "antd/locale/pt_BR";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "IRParser",
  description: "Aplicativo para preparação de documentos para declaração de imposto de renda",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <ConfigProvider
          locale={ptBR}
          theme={{
            token: {
              colorPrimary: "#1677ff",
            },
          }}
        >
          <AntdApp>
            {children}
          </AntdApp>
        </ConfigProvider>
      </body>
    </html>
  );
}
