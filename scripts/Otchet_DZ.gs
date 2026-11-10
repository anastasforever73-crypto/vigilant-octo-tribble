/**
 * Автоматическая сборка отчёта по дебиторской задолженности ООО «Март-трейд».
 *
 * Что делает:
 *   1. По понедельникам берёт листы «Транзит» и «Склад», считает отгрузку
 *      за прошлую неделю (пн–вс) и ДЗ по корзинам старения на дату отчёта.
 *   2. Переплаты (отрицательные остатки) гасит о долги того же контрагента
 *      от старых к новым; непогашенный остаток идёт отдельной строкой
 *      «Авансы и переплаты» и в корзины старения не попадает.
 *   3. Дописывает результат в лист-архив «Архив ДЗ» (одна строка = дата ×
 *      источник × показатель × категория).
 *   4. Пересобирает лист «Динамика ДЗ (авто)» и обе диаграммы из архива.
 *
 * Установка:
 *   Расширения → Apps Script → вставить этот файл → Сохранить.
 *   Затем в меню «Отчёт ДЗ» → «Установить еженедельный запуск».
 *
 * Первый запуск: «Отчёт ДЗ» → «Импортировать историю из листа «Динамика ДЗ»»,
 * чтобы перенести накопленные недели в архив.
 */

// ───────────────────────────── НАСТРОЙКИ ─────────────────────────────

var CONFIG = {

  // ID таблицы с исходными данными. Оставьте '', если листы «Транзит» и
  // «Склад» лежат в этом же файле (в т.ч. подтягиваются через IMPORTRANGE).
  SOURCE_SPREADSHEET_ID: '',

  SOURCES: [
    {
      key: 'Транзит',
      sheetName: 'Транзит',
      headerRow: 19,          // подсказка; реальная строка ищется по заголовкам
      cols: {
        date:   'Дата УПД',            // база для старения и для недели отгрузки
        amount: 'Ст-ть заказа',        // отгружено за неделю
        debt:   'Остаток долга',
        client: 'Конечный получатель'  // ключ схлопывания переплат
      },
      // Строки без даты УПД — неотгруженные заявки: долг там равен стоимости
      // заказа просто потому, что не было ни отгрузки, ни оплаты. В ДЗ не входят.
      undatedNote: 'неотгруженные заявки — в ДЗ не входят'
    },
    {
      key: 'Склад',
      sheetName: 'Склад',
      headerRow: 9,
      cols: {
        date:   'Дата отгрузки',
        amount: 'сумма',
        debt:   'Долг',
        client: 'Направление'
      },
      undatedNote: 'нет даты отгрузки — проверьте строки'
    }
  ],

  // Границы корзин в днях от базовой даты. Меняются здесь и нигде больше.
  BUCKETS: [
    { name: 'Текущая',      maxDays: 14 },
    { name: 'Просроченная', maxDays: 30 },
    { name: 'Сомнительная', maxDays: 180 },
    { name: 'Безнадежная',  maxDays: Infinity }
  ],

  ADVANCE_LABEL: 'Авансы и переплаты',

  ARCHIVE_SHEET:    'Архив ДЗ',
  REPORT_SHEET:     'Динамика ДЗ (авто)',
  LOG_SHEET:        'Журнал ДЗ',
  CHART_DATA_SHEET: '_Данные диаграмм',

  TIMEZONE: 'Europe/Moscow',
  WEEKLY_RUN_HOUR: 8,     // час еженедельного запуска по понедельникам
  TEST_RUN_HOUR: 12       // час разового тестового запуска (сегодня)
};

// ───────────────────────────── МЕНЮ И ЗАПУСК ─────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Отчёт ДЗ')
    .addItem('Собрать за прошлую неделю', 'runWeekly')
    .addItem('Пересобрать на дату…', 'promptAndBuild')
    .addSeparator()
    .addItem('Только перестроить отчёт из архива', 'rebuildReport')
    .addItem('Импортировать историю из листа «Динамика ДЗ»', 'importHistory')
    .addSeparator()
    .addItem('Тестовый запуск сегодня', 'createTestRunToday')
    .addItem('Установить еженедельный запуск', 'createWeeklyTrigger')
    .addItem('Показать активные триггеры', 'showTriggers')
    .addToUi();
}

/**
 * Точка входа для триггера: собирает отчёт на ближайший прошедший понедельник.
 * Если запуск идёт во вторник, датой отчёта всё равно будет понедельник,
 * а неделей — предыдущие пн–вс.
 */
function runWeekly() {
  var reportDate = lastMonday(new Date());
  try {
    buildForDate(reportDate);
  } catch (e) {
    // Триггер работает без вас — ошибка должна остаться в журнале, а не только
    // в служебном логе Apps Script.
    try {
      writeLog(SpreadsheetApp.getActiveSpreadsheet(), reportDate, 'ОШИБКА',
               e.message, [String(e.stack || '').slice(0, 500)]);
    } catch (ignored) {}
    throw e;
  }
}

/** Разовый тестовый запуск: сначала снимает свой триггер, потом считает. */
function runOnce() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runOnce') ScriptApp.deleteTrigger(t);
  });
  runWeekly();
}

function promptAndBuild() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Дата отчёта (понедельник) в формате ДД.ММ.ГГГГ:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var d = parseRuDate(res.getResponseText());
  if (!d) { ui.alert('Не удалось разобрать дату.'); return; }
  if (d.getDay() !== 1) {
    var ok = ui.alert('Указанная дата — не понедельник. Всё равно собрать?', ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
  }
  buildForDate(d);
}

/** Главный сценарий: посчитать, записать в архив, перестроить отчёт. */
function buildForDate(reportDate) {
  var t0 = new Date();
  var weekEnd   = addDays(reportDate, -1);   // воскресенье
  var weekStart = addDays(reportDate, -7);   // понедельник
  var warnings = [];

  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var src = CONFIG.SOURCE_SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SOURCE_SPREADSHEET_ID)
    : ss;

  var results = CONFIG.SOURCES.map(function (cfg) {
    var sheet = src.getSheetByName(cfg.sheetName);
    if (!sheet) throw new Error('Не найден лист «' + cfg.sheetName + '».');
    var values = sheet.getDataRange().getValues();
    var res = collectSource(values, cfg, reportDate, weekStart, weekEnd);
    res.warnings.forEach(function (w) { warnings.push(cfg.key + ': ' + w); });
    return res;
  });

  writeArchive(ss, reportDate, weekStart, weekEnd, results, 'авто');
  rebuildReport();

  var secs = (new Date() - t0) / 1000;
  var summary = results.map(function (r, i) {
    return CONFIG.SOURCES[i].key + ' — отгрузка ' + Math.round(r.shipment) +
           ', ДЗ ' + Math.round(r.total);
  }).join('; ');
  writeLog(ss, reportDate, 'OK', summary + ' (' + secs.toFixed(1) + ' с)', warnings);
}

// ───────────────────────────── РАСЧЁТ ─────────────────────────────

/**
 * Считает один источник на дату отчёта.
 * Возвращает { shipment, buckets, advance, total, warnings }.
 */
function collectSource(values, cfg, reportDate, weekStart, weekEnd) {
  var wanted = [cfg.cols.date, cfg.cols.amount, cfg.cols.debt, cfg.cols.client];
  var headerRow = findHeaderRow(values, wanted, cfg.headerRow);
  var idx = mapHeaders(values[headerRow], wanted, cfg.sheetName);

  var iDate   = idx[norm(cfg.cols.date)];
  var iAmount = idx[norm(cfg.cols.amount)];
  var iDebt   = idx[norm(cfg.cols.debt)];
  var iClient = idx[norm(cfg.cols.client)];

  var shipment = 0;
  var byClient = {};              // клиент → { debts: [{date, amt}], credit }
  var noDate = 0, noDateSum = 0, future = 0, futureSum = 0;

  for (var r = headerRow + 1; r < values.length; r++) {
    var row = values[r];
    var date = toDate(row[iDate]);
    var debt = toNumber(row[iDebt]);

    // 1. Отгрузка за отчётную неделю
    if (date && date >= weekStart && date <= weekEnd) {
      shipment += toNumber(row[iAmount]);
    }

    // 2. Дебиторская задолженность на дату отчёта
    if (debt === 0) continue;
    if (!date) { noDate++; noDateSum += debt; continue; }
    if (date > reportDate) { future++; futureSum += debt; continue; }

    var client = String(row[iClient] || '(без контрагента)').trim();
    if (!byClient[client]) byClient[client] = { debts: [], credit: 0 };
    if (debt > 0) byClient[client].debts.push({ date: date, amt: debt });
    else byClient[client].credit += -debt;
  }

  // 3. Гасим переплаты о долги того же контрагента, от старых к новым
  var buckets = {}, advance = 0, total = 0;
  CONFIG.BUCKETS.forEach(function (b) { buckets[b.name] = 0; });

  Object.keys(byClient).forEach(function (client) {
    var rec = byClient[client];
    rec.debts.sort(function (a, b) { return a.date - b.date; });
    var credit = rec.credit;

    rec.debts.forEach(function (d) {
      if (credit > 0) {
        var take = Math.min(credit, d.amt);
        d.amt -= take;
        credit -= take;
      }
      if (d.amt > 0.005) {
        var days = daysBetween(d.date, reportDate);
        buckets[bucketOf(days)] += d.amt;
        total += d.amt;
      }
    });

    if (credit > 0.005) advance -= credit;   // остался непогашенный аванс
  });

  var warnings = [];
  if (noDate)  warnings.push(noDate + ' строк без даты «' + cfg.cols.date + '» на ' +
                             Math.round(noDateSum) + ' ₽ — ' +
                             (cfg.undatedNote || 'в корзины не разнесены') + '.');
  if (future)  warnings.push(future + ' строк с датой «' + cfg.cols.date +
                             '» позже даты отчёта на ' + Math.round(futureSum) +
                             ' ₽ — ненаступившие, войдут в ДЗ автоматически.');
  if (advance) warnings.push('Непогашенные авансы: ' + Math.round(advance) + ' ₽.');

  return { shipment: shipment, buckets: buckets, advance: advance, total: total, warnings: warnings };
}

function bucketOf(days) {
  for (var i = 0; i < CONFIG.BUCKETS.length; i++) {
    if (days <= CONFIG.BUCKETS[i].maxDays) return CONFIG.BUCKETS[i].name;
  }
  return CONFIG.BUCKETS[CONFIG.BUCKETS.length - 1].name;
}

// ───────────────────────────── ЧТЕНИЕ ЗАГОЛОВКОВ ─────────────────────────────

function norm(s) {
  return String(s === null || s === undefined ? '' : s)
    .toLowerCase().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Ищет строку заголовков: ту, где встречаются все нужные названия колонок.
 * Так вставка строк над таблицей не ломает отчёт.
 */
function findHeaderRow(values, wanted, hintRow) {
  var need = wanted.map(norm);
  var limit = Math.min(values.length, Math.max(hintRow + 15, 45));
  var candidates = [hintRow - 1];
  for (var i = 0; i < limit; i++) if (i !== hintRow - 1) candidates.push(i);

  for (var c = 0; c < candidates.length; c++) {
    var r = candidates[c];
    if (r < 0 || r >= values.length) continue;
    var have = values[r].map(norm);
    var ok = need.every(function (n) { return have.indexOf(n) !== -1; });
    if (ok) return r;
  }
  throw new Error('Не найдена строка заголовков с колонками: ' + wanted.join(', '));
}

/** Первое вхождение каждого заголовка (в «Складе» есть дубли названий). */
function mapHeaders(headerRow, wanted, sheetName) {
  var map = {};
  headerRow.forEach(function (h, i) {
    var n = norm(h);
    if (n && !(n in map)) map[n] = i;
  });
  wanted.forEach(function (w) {
    if (!(norm(w) in map)) {
      throw new Error('На листе «' + sheetName + '» нет колонки «' + w + '».');
    }
  });
  return map;
}

// ───────────────────────────── АРХИВ ─────────────────────────────

var ARCHIVE_HEADER = ['Дата отчёта', 'Неделя с', 'Неделя по', 'Источник',
                      'Показатель', 'Категория', 'Сумма', 'Способ', 'Обновлено'];

function writeArchive(ss, reportDate, weekStart, weekEnd, results, method) {
  var sheet = getOrCreate(ss, CONFIG.ARCHIVE_SHEET);
  var now = new Date();
  var rows = [];

  results.forEach(function (res, i) {
    var key = CONFIG.SOURCES[i].key;
    rows.push([reportDate, weekStart, weekEnd, key, 'Отгрузка', 'Отгружено', res.shipment, method, now]);
    CONFIG.BUCKETS.forEach(function (b) {
      rows.push([reportDate, weekStart, weekEnd, key, 'ДЗ', b.name, res.buckets[b.name], method, now]);
    });
    rows.push([reportDate, weekStart, weekEnd, key, 'Аванс', CONFIG.ADVANCE_LABEL, res.advance, method, now]);
  });

  appendArchiveRows(sheet, rows, reportDate);
}

/** Дописывает строки, предварительно убрав прежние записи за ту же дату. */
function appendArchiveRows(sheet, rows, reportDate) {
  var existing = [];
  if (sheet.getLastRow() > 1) {
    existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, ARCHIVE_HEADER.length).getValues();
  }
  var stamp = dateKey(reportDate);
  var kept = existing.filter(function (r) {
    var d = toDate(r[0]);
    return !d || dateKey(d) !== stamp;
  });

  var all = kept.concat(rows).sort(function (a, b) {
    var da = toDate(a[0]), db = toDate(b[0]);
    return (da && db) ? da - db : 0;
  });

  sheet.clear();
  sheet.getRange(1, 1, 1, ARCHIVE_HEADER.length).setValues([ARCHIVE_HEADER]).setFontWeight('bold');
  if (all.length) sheet.getRange(2, 1, all.length, ARCHIVE_HEADER.length).setValues(all);
  sheet.getRange(2, 1, Math.max(all.length, 1), 3).setNumberFormat('dd.mm.yyyy');
  sheet.getRange(2, 7, Math.max(all.length, 1), 1).setNumberFormat('#,##0');
  sheet.getRange(2, 9, Math.max(all.length, 1), 1).setNumberFormat('dd.mm.yyyy hh:mm');
  sheet.setFrozenRows(1);
}

function readArchive(ss) {
  var sheet = ss.getSheetByName(CONFIG.ARCHIVE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, ARCHIVE_HEADER.length).getValues()
    .filter(function (r) { return toDate(r[0]); });
}

// ───────────────────────────── ОТЧЁТ ─────────────────────────────

/** Полностью пересобирает лист отчёта и диаграммы из архива. */
function rebuildReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = readArchive(ss);
  if (!data.length) throw new Error('Архив пуст — сначала соберите отчёт или импортируйте историю.');

  // ключ: датаКлюч|источник|показатель|категория → сумма
  var byKey = {}, dateSet = {};
  data.forEach(function (r) {
    var d = toDate(r[0]);
    var k = dateKey(d);
    dateSet[k] = d;
    byKey[[k, r[3], r[4], r[5]].join('|')] = toNumber(r[6]);
  });
  var dates = Object.keys(dateSet).sort().map(function (k) { return dateSet[k]; });
  var val = function (d, src, ind, cat) {
    var v = byKey[[dateKey(d), src, ind, cat].join('|')];
    return (v === undefined) ? '' : v;
  };

  var srcKeys = CONFIG.SOURCES.map(function (s) { return s.key; });
  var out = [], bold = [], money = [];
  var push = function (row, isBold) { out.push(row); if (isBold) bold.push(out.length); };
  var sumRow = function (ind, cat) {
    return dates.map(function (d) {
      var s = 0, any = false;
      srcKeys.forEach(function (k) {
        var v = val(d, k, ind, cat);
        if (v !== '') { s += v; any = true; }
      });
      return any ? s : '';
    });
  };
  var srcRow = function (key, ind, cat) {
    return dates.map(function (d) { return val(d, key, ind, cat); });
  };

  // Таблица 1 — отгрузка
  push(['Отгружено за неделю, руб.'].concat(sumRow('Отгрузка', 'Отгружено')), true);
  srcKeys.forEach(function (k) { push([k].concat(srcRow(k, 'Отгрузка', 'Отгружено')), false); });
  push([''].concat(dates.map(function () { return ''; })), false);

  // Таблица 2 — ДЗ
  var dzHeaderRow = out.length + 1;
  push(['Дебиторская задолженность'].concat(dates.map(function () { return ''; })), true);
  var catRows = {};
  CONFIG.BUCKETS.forEach(function (b) {
    push([b.name + ' (' + bucketCaption(b) + ')'].concat(sumRow('ДЗ', b.name)), true);
    catRows[b.name] = out.length;
    srcKeys.forEach(function (k) { push([k].concat(srcRow(k, 'ДЗ', b.name)), false); });
  });

  var totalRow = dates.map(function (d) {
    var s = 0;
    CONFIG.BUCKETS.forEach(function (b) {
      srcKeys.forEach(function (k) {
        var v = val(d, k, 'ДЗ', b.name);
        if (v !== '') s += v;
      });
    });
    return s;
  });
  push(['ИТОГО'].concat(totalRow), true);
  var totalRowIdx = out.length;

  push([CONFIG.ADVANCE_LABEL + ' (справочно)'].concat(sumRow('Аванс', CONFIG.ADVANCE_LABEL)), true);
  srcKeys.forEach(function (k) { push([k].concat(srcRow(k, 'Аванс', CONFIG.ADVANCE_LABEL)), false); });

  // Блок изменений неделя к неделе
  push([''].concat(dates.map(function () { return ''; })), false);
  push(['Изменение к предыдущей неделе'].concat(dates.map(function () { return ''; })), true);
  var deltaOf = function (row) {
    return row.map(function (v, i) {
      if (i === 0 || v === '' || row[i - 1] === '') return '';
      return v - row[i - 1];
    });
  };
  push(['Отгружено'].concat(deltaOf(sumRow('Отгрузка', 'Отгружено'))), false);
  CONFIG.BUCKETS.forEach(function (b) {
    push([b.name].concat(deltaOf(sumRow('ДЗ', b.name))), false);
  });
  push(['ИТОГО ДЗ'].concat(deltaOf(totalRow)), true);

  // Запись на лист
  var sheet = getOrCreate(ss, CONFIG.REPORT_SHEET);
  sheet.getCharts().forEach(function (c) { sheet.removeChart(c); });
  sheet.clear();

  var title = 'Динамика ДЗ — ООО «Март-трейд». Обновлено ' +
              Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd.MM.yyyy HH:mm');
  sheet.getRange(1, 1).setValue(title).setFontWeight('bold').setFontSize(12);

  var headerVals = ['Показатель'].concat(dates.map(function (d) { return d; }));
  sheet.getRange(2, 1, 1, headerVals.length).setValues([headerVals])
       .setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange(2, 2, 1, dates.length).setNumberFormat('dd.mm.yy');

  sheet.getRange(3, 1, out.length, dates.length + 1).setValues(out);
  sheet.getRange(3, 2, out.length, dates.length).setNumberFormat('#,##0');
  bold.forEach(function (i) { sheet.getRange(2 + i, 1, 1, dates.length + 1).setFontWeight('bold'); });
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(1);
  sheet.setColumnWidth(1, 300);

  try {
    rebuildCharts(ss, sheet, dates, out, catRows, totalRowIdx, dzHeaderRow);
  } catch (e) {
    writeLog(ss, new Date(), 'ПРЕДУПРЕЖДЕНИЕ', 'Диаграммы не перестроены: ' + e.message, []);
  }
}

function bucketCaption(b) {
  var i = CONFIG.BUCKETS.indexOf(b);
  var from = i === 0 ? 0 : CONFIG.BUCKETS[i - 1].maxDays + 1;
  return b.maxDays === Infinity ? 'свыше ' + (from - 1) + ' дн.' : 'от ' + from + ' до ' + b.maxDays + ' дн.';
}

/**
 * Диаграммы строятся с отдельного служебного листа: там данные лежат
 * транспонированно и сплошным блоком, поэтому ряды не разъезжаются.
 */
function rebuildCharts(ss, sheet, dates, out, catRows, totalRowIdx, dzHeaderRow) {
  var cd = getOrCreate(ss, CONFIG.CHART_DATA_SHEET);
  cd.clear();

  var srcKeys = CONFIG.SOURCES.map(function (s) { return s.key; });
  var shipHeader = ['Дата'].concat(srcKeys);
  var shipRows = dates.map(function (d, i) {
    return [d].concat(srcKeys.map(function (k, j) { return out[1 + j][i + 1] || 0; }));
  });

  var dzHeader = ['Дата'].concat(CONFIG.BUCKETS.map(function (b) { return b.name; }));
  var dzRows = dates.map(function (d, i) {
    return [d].concat(CONFIG.BUCKETS.map(function (b) {
      return out[catRows[b.name] - 1][i + 1] || 0;
    }));
  });

  cd.getRange(1, 1, 1, shipHeader.length).setValues([shipHeader]);
  if (shipRows.length) cd.getRange(2, 1, shipRows.length, shipHeader.length).setValues(shipRows);

  var col2 = shipHeader.length + 2;
  cd.getRange(1, col2, 1, dzHeader.length).setValues([dzHeader]);
  if (dzRows.length) cd.getRange(2, col2, dzRows.length, dzHeader.length).setValues(dzRows);

  cd.getRange(2, 1, Math.max(dzRows.length, 1), 1).setNumberFormat('dd.mm.yy');
  cd.getRange(2, col2, Math.max(dzRows.length, 1), 1).setNumberFormat('dd.mm.yy');
  cd.hideSheet();

  var chart1 = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(cd.getRange(1, 1, shipRows.length + 1, shipHeader.length))
    .setOption('title', 'Отгружено за неделю, руб. — Транзит и Склад')
    .setOption('isStacked', true)
    .setOption('legend', { position: 'bottom' })
    .setPosition(2, dates.length + 3, 0, 0)
    .build();
  sheet.insertChart(chart1);

  var chart2 = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(cd.getRange(1, col2, dzRows.length + 1, dzHeader.length))
    .setOption('title', 'Дебиторская задолженность по категориям')
    .setOption('legend', { position: 'bottom' })
    .setPosition(20, dates.length + 3, 0, 0)
    .build();
  sheet.insertChart(chart2);
}

// ───────────────────────────── ИМПОРТ ИСТОРИИ ─────────────────────────────

/**
 * Разовый перенос накопленных недель из старого листа «Динамика ДЗ» в архив.
 * Берутся только колонки со значениями ДЗ (колонки «Изменение…» пропускаются).
 * Отгрузка переносится из строк «Отгружено за неделю» / «Транзит» / «Склад».
 */
function importHistory() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Динамика ДЗ');
  if (!sheet) throw new Error('Лист «Динамика ДЗ» не найден.');
  var v = sheet.getDataRange().getValues();

  // Строки-якоря
  var rowShipTotal = -1, rowsShip = {}, catAnchor = {};
  for (var r = 0; r < v.length; r++) {
    var a = norm(v[r][0]);
    if (!a) continue;
    if (a.indexOf('отгружено за неделю') === 0) {
      rowShipTotal = r;
      CONFIG.SOURCES.forEach(function (s, i) { rowsShip[s.key] = r + 1 + i; });
    }
    CONFIG.BUCKETS.forEach(function (b) {
      if (a.indexOf(norm(b.name)) === 0 && catAnchor[b.name] === undefined) catAnchor[b.name] = r;
    });
  }

  // Колонки с датами
  var headerRows = [rowShipTotal, catAnchor[CONFIG.BUCKETS[0].name] - 1].filter(function (x) { return x >= 0; });
  var colDate = {};
  headerRows.forEach(function (hr) {
    for (var c = 1; c < v[hr].length; c++) {
      var cell = v[hr][c];
      if (colDate[c]) continue;
      var d = toDate(cell) || parseRuDate(String(cell).replace(/^.*?ДЗ на\s*/i, ''));
      if (d && norm(cell).indexOf('изменени') === -1) colDate[c] = d;
    }
  });

  var rows = [], now = new Date(), dates = [];
  Object.keys(colDate).forEach(function (c) {
    c = Number(c);
    var d = colDate[c], ws = addDays(d, -7), we = addDays(d, -1);
    dates.push(d);
    CONFIG.SOURCES.forEach(function (s, i) {
      if (rowsShip[s.key] !== undefined) {
        var ship = toNumber(v[rowsShip[s.key]][c]);
        if (ship) rows.push([d, ws, we, s.key, 'Отгрузка', 'Отгружено', ship, 'история', now]);
      }
      CONFIG.BUCKETS.forEach(function (b) {
        var ar = catAnchor[b.name];
        if (ar === undefined) return;
        var amt = toNumber(v[ar + 1 + i][c]);
        if (amt) rows.push([d, ws, we, s.key, 'ДЗ', b.name, amt, 'история', now]);
      });
    });
  });

  var sheetArch = getOrCreate(ss, CONFIG.ARCHIVE_SHEET);
  var existing = sheetArch.getLastRow() > 1
    ? sheetArch.getRange(2, 1, sheetArch.getLastRow() - 1, ARCHIVE_HEADER.length).getValues()
    : [];
  var importedKeys = {};
  dates.forEach(function (d) { importedKeys[dateKey(d)] = true; });
  var kept = existing.filter(function (r) {
    var d = toDate(r[0]);
    return !d || !importedKeys[dateKey(d)];
  });

  var all = kept.concat(rows).sort(function (a, b) {
    var da = toDate(a[0]), db = toDate(b[0]);
    return (da && db) ? da - db : 0;
  });
  sheetArch.clear();
  sheetArch.getRange(1, 1, 1, ARCHIVE_HEADER.length).setValues([ARCHIVE_HEADER]).setFontWeight('bold');
  if (all.length) sheetArch.getRange(2, 1, all.length, ARCHIVE_HEADER.length).setValues(all);
  sheetArch.getRange(2, 1, Math.max(all.length, 1), 3).setNumberFormat('dd.mm.yyyy');
  sheetArch.getRange(2, 7, Math.max(all.length, 1), 1).setNumberFormat('#,##0');
  sheetArch.setFrozenRows(1);

  writeLog(ss, new Date(), 'ИМПОРТ',
    'Перенесено ' + rows.length + ' строк за ' + dates.length + ' дат.',
    ['Импортированные значения помечены «история» — они взяты как есть и не пересчитаны.']);

  SpreadsheetApp.getUi().alert('Импортировано дат: ' + dates.length + ', строк: ' + rows.length +
    '.\nПроверьте колонки, где раньше были ошибки, и при необходимости пересоберите их через «Пересобрать на дату…».');
}

// ───────────────────────────── СЛУЖЕБНОЕ ─────────────────────────────

/** Ставит разовый запуск на сегодня, на час из CONFIG.TEST_RUN_HOUR. */
function createTestRunToday() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runOnce') ScriptApp.deleteTrigger(t);
  });

  var now = new Date();
  var when = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                      CONFIG.TEST_RUN_HOUR, 0, 0);
  var late = false;
  if (when.getTime() - now.getTime() < 60 * 1000) {   // указанный час уже прошёл
    when = new Date(now.getTime() + 2 * 60 * 1000);
    late = true;
  }
  ScriptApp.newTrigger('runOnce').timeBased().at(when).create();

  var f = function (d, p) { return Utilities.formatDate(d, CONFIG.TIMEZONE, p); };
  var reportDate = lastMonday(when);
  SpreadsheetApp.getUi().alert(
    (late ? 'Час ' + CONFIG.TEST_RUN_HOUR + ':00 уже прошёл, запуск назначен через 2 минуты — на '
          : 'Тестовый запуск назначен на ') + f(when, 'dd.MM.yyyy HH:mm') + '.\n\n' +
    'Дата отчёта: ' + f(reportDate, 'dd.MM.yyyy') + ', неделя ' +
    f(addDays(reportDate, -7), 'dd.MM') + '–' + f(addDays(reportDate, -1), 'dd.MM') + '.\n\n' +
    'Google запускает триггеры с разбросом до 15 минут. Результат — на листах «' +
    CONFIG.REPORT_SHEET + '» и «' + CONFIG.LOG_SHEET + '».');
}

/** Диагностика: показывает, какие триггеры реально стоят в проекте. */
function showTriggers() {
  var list = ScriptApp.getProjectTriggers().map(function (t) {
    return '• ' + t.getHandlerFunction() + ' — ' + t.getEventType();
  });
  SpreadsheetApp.getUi().alert(list.length
    ? 'Активные триггеры:\n\n' + list.join('\n')
    : 'Активных триггеров нет.\n\nЗначит, автоматический запуск не был поставлен — ' +
      'нажмите «Тестовый запуск сегодня» или «Установить еженедельный запуск».');
}

function createWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runWeekly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runWeekly')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(CONFIG.WEEKLY_RUN_HOUR)
    .inTimezone(CONFIG.TIMEZONE)
    .create();
  SpreadsheetApp.getUi().alert('Готово: отчёт будет собираться по понедельникам около ' +
    CONFIG.WEEKLY_RUN_HOUR + ':00.');
}

function writeLog(ss, reportDate, status, message, warnings) {
  var sheet = getOrCreate(ss, CONFIG.LOG_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 5)
      .setValues([['Запуск', 'Дата отчёта', 'Статус', 'Результат', 'Предупреждения']])
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), reportDate, status, message, (warnings || []).join(' | ')]);
  sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('dd.mm.yyyy hh:mm');
  sheet.getRange(sheet.getLastRow(), 2).setNumberFormat('dd.mm.yyyy');
}

function getOrCreate(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function toNumber(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  var s = String(v).replace(/\u00a0/g, '').replace(/\s/g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Дата из ячейки: Date, серийный номер Excel/Sheets или строка ДД.ММ.ГГГГ. */
function toDate(v) {
  if (v instanceof Date && !isNaN(v)) return midnight(v);
  if (typeof v === 'number' && v > 1000 && v < 100000) {
    return midnight(new Date(Date.UTC(1899, 11, 30) + v * 86400000));
  }
  if (typeof v === 'string') return parseRuDate(v);
  return null;
}

function parseRuDate(s) {
  var m = String(s).match(/(\d{1,2})[.\-\/\s](\d{1,2})[.\-\/\s](\d{2,4})/);
  if (!m) return null;
  var y = Number(m[3]);
  if (y < 100) y += 2000;
  var d = new Date(y, Number(m[2]) - 1, Number(m[1]));
  return isNaN(d) ? null : midnight(d);
}

function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function daysBetween(a, b) { return Math.round((midnight(b) - midnight(a)) / 86400000); }
function dateKey(d) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function lastMonday(d) {
  var x = midnight(d);
  var diff = (x.getDay() + 6) % 7;   // пн → 0, вс → 6
  return addDays(x, -diff);
}