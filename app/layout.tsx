import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Март-Трейд — управленческий дашборд",
  description: "Оперативные показатели, ДДС, товар, логистика и продажи.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
