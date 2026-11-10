# Проверка текущего состояния — 2026-09-14

- `npm run build`: успешно вне песочницы; внутри песочницы Turbopack не смог открыть локальный порт.
- `tsc --noEmit --incremental false`: успешно.
- `git diff --check`: успешно.
- `npm run lint`: 34 ошибки и 17 предупреждений; подробности ниже.
- Проверки в браузере и запросы к действующим Google Sheets/Финтабло не выполнялись.

В этом продолжении восстановлена исходная иконка в `public/favicon.svg`. Сборка автоматически вернула `next-env.d.ts` к состоянию HEAD. Остальные изменения уже присутствовали при начале проверки.

## Изменённые файлы относительно HEAD

```text
 D favicon.svg
 D globals.css
 D layout.tsx
 M next.config.ts
 M package-lock.json
 D page.tsx
?? VERIFICATION.md
?? app/api/dashboard/route.ts
?? app/api/debt-metadata/route.ts
?? app/api/fintablo/route.ts
?? app/api/google-sheets/route.ts
?? app/api/settings/route.ts
?? app/dashboard-overrides.css
?? app/globals.css
?? app/layout.tsx
?? app/lib/admin-session.ts
?? app/lib/dashboard-data.ts
?? app/lib/debt-data.ts
?? app/lib/fintablo-adapter.ts
?? app/lib/fintablo.ts
?? app/lib/source-settings.ts
?? app/mart-data.json
?? app/page.tsx
?? public/favicon.svg
```

## Результаты ESLint

Команда: npm run lint

34 ошибки, 17 предупреждений.

| Файл | Строка | Уровень | Правило | Сообщение |
| --- | --- | --- | --- | --- |
| app/api/debt-metadata/route.ts | 1:10 | Предупреждение | @typescript-eslint/no-unused-vars | 'createHmac' is defined but never used. |
| app/page.tsx | 20:3 | Предупреждение | @typescript-eslint/no-unused-vars | 'RefreshCw' is defined but never used. |
| app/page.tsx | 36:3 | Предупреждение | @typescript-eslint/no-unused-vars | 'ComposedChart' is defined but never used. |
| app/page.tsx | 47:7 | Предупреждение | @typescript-eslint/no-unused-vars | 'monthly' is assigned a value but never used. |
| app/page.tsx | 69:7 | Предупреждение | @typescript-eslint/no-unused-vars | 'kpis' is assigned a value but never used. |
| app/page.tsx | 144:7 | Предупреждение | @typescript-eslint/no-unused-vars | 'alerts' is assigned a value but never used. |
| app/page.tsx | 191:63 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 208:42 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 212:24 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 311:21 | Предупреждение | @typescript-eslint/no-unused-vars | 'i' is defined but never used. |
| app/page.tsx | 339:25 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 358:70 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 438:46 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 442:41 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 448:42 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 613:10 | Предупреждение | @typescript-eslint/no-unused-vars | 'GoodsLegacy' is defined but never used. |
| app/page.tsx | 734:33 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 762:10 | Предупреждение | @typescript-eslint/no-unused-vars | 'CashLegacy' is defined but never used. |
| app/page.tsx | 894:10 | Предупреждение | @typescript-eslint/no-unused-vars | 'LogisticsLegacy' is defined but never used. |
| app/page.tsx | 1034:34 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1045:10 | Предупреждение | @typescript-eslint/no-unused-vars | 'SalesLegacy' is defined but never used. |
| app/page.tsx | 1148:26 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1283:49 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1283:101 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1456:26 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1459:14 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1459:43 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1460:14 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1460:43 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1461:16 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1461:47 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1462:16 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1462:47 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1465:17 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1467:20 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1469:20 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1477:5 | Предупреждение | @typescript-eslint/no-unused-vars | 'revenue' is assigned a value but never used. |
| app/page.tsx | 1478:5 | Предупреждение | @typescript-eslint/no-unused-vars | 'oldRevenue' is assigned a value but never used. |
| app/page.tsx | 1479:5 | Предупреждение | @typescript-eslint/no-unused-vars | 'orders' is assigned a value but never used. |
| app/page.tsx | 1480:5 | Предупреждение | @typescript-eslint/no-unused-vars | 'oldOrdersCount' is assigned a value but never used. |
| app/page.tsx | 1483:5 | Предупреждение | @typescript-eslint/no-unused-vars | 'volume' is assigned a value but never used. |
| app/page.tsx | 1489:14 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1489:43 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1490:17 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1490:46 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1512:29 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1525:5 | Предупреждение | @typescript-eslint/no-unused-expressions | Expected an assignment or function call and instead saw an expression. |
| app/page.tsx | 1609:13 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1679:32 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1681:48 | Ошибка | @typescript-eslint/no-explicit-any | Unexpected any. Specify a different type. |
| app/page.tsx | 1685:5 | Ошибка | react-hooks/set-state-in-effect | Error: Calling setState synchronously within an effect can trigger cascading renders |
