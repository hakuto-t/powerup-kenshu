/**
 * 他研修スケジュールスプシ（2026年／2027年）から
 *   - A: 日付(MM/DD)
 *   - B: 曜日
 *   - C: 祝日名
 *   - D: PBC
 *   - E: 顧問
 *   - F: 東京プログラム
 *   - G: 浜松プログラム
 *   - H: 静岡プログラム
 * を読み取り、MonthData[] に変換する。
 */

// 小澤候補帯（ozawa-range.json と同期）
const OZAWA_RANGES = {
  '2026-08': { start: '2026-08-10', end: '2026-08-27' },
  '2026-09': { start: '2026-09-07', end: '2026-09-27' },
  '2026-10': { start: '2026-10-08', end: '2026-10-25' },
  '2026-11': { start: '2026-11-09', end: '2026-11-25' },
  '2026-12': { start: '2026-12-07', end: '2026-12-24' },
  '2027-01': { start: '2027-01-06', end: '2027-01-21' },
  '2027-02': null,
  '2027-03': { start: '2027-03-08', end: '2027-03-28' },
  '2027-04': { start: '2027-04-09', end: '2027-04-23' },
  '2027-05': { start: '2027-05-10', end: '2027-05-26' },
  '2027-06': { start: '2027-06-07', end: '2027-06-27' },
  '2027-07': { start: '2027-07-07', end: '2027-07-25' },
};

const OTHER_COLUMN_MAP = [
  { col: 3, label: 'PBC' },           // D列（1=A）
  { col: 4, label: '顧問' },          // E列
  { col: 5, label: '東京プログラム' }, // F列
  { col: 6, label: '浜松プログラム' }, // G列
  { col: 7, label: '静岡プログラム' }, // H列
];

/**
 * 2026年8月〜2027年7月の MonthData[] を返す
 */
// 他研修スプシIDは固定（ユーザー提供済み）
const DEFAULT_OTHER_SHEET_2026 = '1eMVgggO6lXiRs4pbTRLch6Wg4CpibPmdqYz0syXGS7I';
const DEFAULT_OTHER_SHEET_2027 = '1fZovD5c-Pn3eggwU_kYrqEF_d_lOHuOkqHEnpnwRRck';

function buildMonthsForYear(fiscalYear) {
  if (fiscalYear !== 2026) throw new Error('fiscalYear=2026のみ対応');

  // CacheService で6時間キャッシュ（他研修スプシへの読み取り回数を大幅削減）
  const cache = CacheService.getScriptCache();
  const cacheKey = 'months_' + fiscalYear + '_v3';
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fallthrough */ }
  }

  const props = PropertiesService.getScriptProperties();
  const id2026 = props.getProperty('OTHER_SHEET_2026') || DEFAULT_OTHER_SHEET_2026;
  const id2027 = props.getProperty('OTHER_SHEET_2027') || DEFAULT_OTHER_SHEET_2027;

  // 個別にtry-catchして、片方失敗でももう片方は活かす
  let rows2026 = {}, rows2027 = {};
  if (id2026) {
    try { rows2026 = readYearSheet(id2026, 2026); }
    catch (e) { Logger.log('2026年スプシ読み取り失敗: ' + e.message); }
  }
  if (id2027) {
    try { rows2027 = readYearSheet(id2027, 2027); }
    catch (e) { Logger.log('2027年スプシ読み取り失敗: ' + e.message); }
  }
  const allRows = { ...rows2026, ...rows2027 };

  const keys = Object.keys(OZAWA_RANGES).sort();
  const months = [];
  for (const k of keys) {
    const [y, m] = k.split('-').map(Number);
    const range = OZAWA_RANGES[k];
    if (!range) {
      months.push({ year: y, month: m, ozawaRange: null, days: [], skip: true });
      continue;
    }
    const lastDay = new Date(y, m, 0).getDate();
    const days = [];
    for (let d = 1; d <= lastDay; d++) {
      const iso = Utilities.formatString('%04d-%02d-%02d', y, m, d);
      const row = allRows[iso] || {};
      const inRange = iso >= range.start && iso <= range.end;
      days.push({
        date: iso,
        weekday: new Date(iso + 'T00:00:00+09:00').getDay(),
        holiday: row.holiday || null,
        inCandidateRange: inRange,
        otherPrograms: row.otherPrograms || [],
      });
    }
    months.push({ year: y, month: m, ozawaRange: range, days });
  }
  // キャッシュ保存（6時間）。サイズ上限100KBに注意
  try {
    const serialized = JSON.stringify(months);
    if (serialized.length < 100000) cache.put(cacheKey, serialized, 21600);
  } catch (e) { Logger.log('cache put failed: ' + e.message); }
  return months;
}

/**
 * 1年ぶんのシートを読み取って、{ 'YYYY-MM-DD': {holiday, otherPrograms} } を返す
 */
function readYearSheet(sheetId, year) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sheetName = String(year) + '年';
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`シート ${sheetName} が見つかりません`);

  // ヘッダー行をスキップ、データ行を全行取得（A〜H列のみ）
  const lastRow = sheet.getLastRow();
  if (lastRow < 4) return {};
  const range = sheet.getRange(4, 1, lastRow - 3, 8).getValues(); // A4:H
  const out = {};
  for (const r of range) {
    const dateCell = r[0]; // A列
    if (!dateCell) continue;
    let mmdd = '';
    if (dateCell instanceof Date) {
      // 日付オブジェクト（シートのフォーマットに依存）
      mmdd = Utilities.formatDate(dateCell, 'JST', 'MM/dd');
    } else {
      mmdd = String(dateCell).trim();
    }
    const match = mmdd.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
    if (!match) continue;
    const m = +match[1], d = +match[2];
    const iso = Utilities.formatString('%04d-%02d-%02d', year, m, d);

    const holiday = r[2] ? String(r[2]).trim() : null; // C列
    const otherPrograms = [];
    for (const { col, label } of OTHER_COLUMN_MAP) {
      const val = r[col] ? String(r[col]).trim() : '';
      if (val) otherPrograms.push({ column: label, name: val });
    }
    out[iso] = { holiday: holiday || null, otherPrograms };
  }
  return out;
}
