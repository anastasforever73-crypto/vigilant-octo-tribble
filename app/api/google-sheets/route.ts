import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";
import { guard } from '@/app/lib/auth';

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

export async function GET(request: NextRequest) {
  const denied = guard(request, 'admin');
  if (denied) return denied;
  return NextResponse.json({ error: "Демонстрационный режим: реальные источники отключены" }, { status: 503 });
}

// Preserved real-source implementation; not exposed by this demo route.
async function readConfiguredGoogleSheets() {
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
    console.error("Google Sheets API: request failed");
    const message = error instanceof Error && (/^Не задана переменная GOOGLE_(SERVICE_ACCOUNT_EMAIL|PRIVATE_KEY|SHEET_ID)$/.test(error.message) || error.message === "GOOGLE_SHEET_RANGES должен быть JSON-массивом строк") ? error.message : "Не удалось прочитать Google Sheets";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
