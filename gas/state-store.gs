/**
 * 状態保存スプシの読み書き
 *
 * スプシID が未設定なら初回アクセス時に SpreadsheetApp.create() で自動生成し、
 * STATE_SHEET プロパティに保存。以降はそれを使う。
 *
 * レイアウト：
 *   sheet "state"
 *     A1: "state"             B1: JSON文字列（AppState全体）
 *     A2: "lastUpdated"       B2: ISO文字列
 *     A3: "version"           B3: number
 *     A4: "savedAt"           B4: ISO文字列
 *   sheet "log"（監査ログ）
 *     timestamp / version / companies / confirmed / byteSize
 */

const STATE_SPREADSHEET_NAME = 'エスト_パワーアップ研修_状態_2026年度';

function loadState(fiscalYear) {
  const ss = getStateSheet();
  const sheet = ss.getSheetByName('state') || ss.insertSheet('state');
  const value = sheet.getRange('B1').getValue();
  if (!value) {
    return emptyState(fiscalYear);
  }
  try {
    return JSON.parse(value);
  } catch (e) {
    Logger.log('loadState: JSON.parse failed: ' + e.message + ' — returning empty');
    return emptyState(fiscalYear);
  }
}

function saveState(fiscalYear, state) {
  const ss = getStateSheet();
  const sheet = ss.getSheetByName('state') || ss.insertSheet('state');
  sheet.getRange('A1').setValue('state');
  sheet.getRange('B1').setValue(JSON.stringify(state));
  sheet.getRange('A2').setValue('lastUpdated');
  sheet.getRange('B2').setValue(state.lastUpdated || new Date().toISOString());
  sheet.getRange('A3').setValue('version');
  sheet.getRange('B3').setValue(state.version || 0);
  sheet.getRange('A4').setValue('savedAt');
  sheet.getRange('B4').setValue(new Date().toISOString());

  // 監査ログ
  try {
    const log = ss.getSheetByName('log') || ss.insertSheet('log');
    if (log.getLastRow() === 0) {
      log.appendRow(['timestamp', 'version', 'companies', 'confirmed', 'byteSize']);
    }
    log.appendRow([
      new Date().toISOString(),
      state.version || 0,
      (state.companies || []).length,
      (state.assignments || []).filter(a => a.confirmed).length,
      JSON.stringify(state).length,
    ]);
  } catch (e) { Logger.log('log append failed: ' + e.message); }
}

/**
 * 状態保存スプシを返す。未設定なら自動生成し、STATE_SHEET プロパティに保存。
 */
function getStateSheet() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('STATE_SHEET');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      Logger.log('既存 STATE_SHEET を開けず再生成: ' + e.message);
      id = null;
    }
  }
  // 自動生成
  const newSS = SpreadsheetApp.create(STATE_SPREADSHEET_NAME);
  id = newSS.getId();
  props.setProperty('STATE_SHEET', id);
  Logger.log('STATE_SHEET 自動生成：' + id);
  // 最初のシートを state にリネーム
  const sheet0 = newSS.getSheets()[0];
  sheet0.setName('state');
  return newSS;
}

function emptyState(fiscalYear) {
  return {
    version: 0,
    lastUpdated: new Date().toISOString(),
    fiscalYear,
    companies: [],
    assignments: [],
  };
}
