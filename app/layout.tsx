import type { Metadata } from "next";
import "./globals.css";
import "./dashboard-overrides.css";

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
