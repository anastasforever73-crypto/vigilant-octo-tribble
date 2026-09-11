import { google } from "googleapis";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RANGES = [
  "ДДС недельный - по статьям!A:Z",
  "техн.лист плита - заказы!A:Z",
  "дебиторка (расчет)!A:Z",
  "Кредиторка по Заводу (1с)!A:Z",
];

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная ${name}`);
  return value;
}

function ranges() {
  const configured = process.env.GOOGLE_SHEET_RANGES;
  if (!configured) return DEFAULT_RANGES;
  const parsed: unknown = JSON.parse(configured);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("GOOGLE_SHEET_RANGES должен быть JSON-массивом строк");
  }
  return parsed;
}

export async function GET() {
  try {
    const auth = new google.auth.JWT({
      email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      key: required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: required("GOOGLE_SHEET_ID"),
      ranges: ranges(),
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      source: "google-sheets",
      ranges: response.data.valueRanges ?? [],
    });
  } catch (error) {
    console.error("Google Sheets API:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка чтения Google Sheets" },
      { status: 500 },
    );
  }
}
