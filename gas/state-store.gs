/**
 * 状態保存スプシの読み書き
 *
 * スプシID が未設定なら初回アクセス時に SpreadsheetApp.create() で自動生成し、
 * STATE_SHEET プロパティに保存。以降はそれを使う。
 *
 * v5.3 レイアウト（チャンク化 + base64）：
 *   sheet "state"
 *     A1: "state"          B1: "__CHUNKED_B64__"      C1: chunk1
 *     A2: "chunks"         B2: N（チャンク数）         C2: chunk2
 *     A3: "lastUpdated"    B3: ISO文字列              C3: chunk3
 *     A4: "version"        B4: number                  C4: chunk4
 *     A5: "savedAt"        B5: ISO文字列              C5: chunk5
 *     ...                                              CN: chunkN
 *   - state 全体を JSON.stringify → UTF-8 → base64 → 40000文字ごとに分割
 *   - セルあたり50000文字制限のため chunk 化。base64 は '=' パディングのみで先頭 '=' にならないため安全
 *
 * 旧v5.x レイアウト（レガシー互換読み取りのみ）：
 *   sheet "state"
 *     A1: "state"          B1: JSON文字列（AppState全体・セル上限超えで truncation リスクあり）
 *     A2: "lastUpdated"    B2: ISO
 *     A3: "version"        B3: number
 *     A4: "savedAt"        B4: ISO
 *
 *   sheet "log"（監査ログ）
 *     timestamp / version / companies / confirmed / byteSize
 */

const STATE_SPREADSHEET_NAME = 'エスト_パワーアップ研修_状態_2026年度';
const CHUNK_SIZE = 40000; // セル上限 50000 に余裕を持たせる
const CHUNK_MARKER = '__CHUNKED_B64__';

function loadState(fiscalYear) {
  const ss = getStateSheet();
  const sheet = ss.getSheetByName('state') || ss.insertSheet('state');

  const b1 = String(sheet.getRange('B1').getValue() || '');

  // 新形式（チャンク化 + base64）を優先
  if (b1 === CHUNK_MARKER) {
    const chunkCount = Number(sheet.getRange('B2').getValue()) || 0;
    if (chunkCount > 0) {
      try {
        const values = sheet.getRange(1, 3, chunkCount, 1).getValues();
        const encoded = values.map(function(r) { return String(r[0] || ''); }).join('');
        const bytes = Utilities.base64Decode(encoded);
        const json = Utilities.newBlob(bytes).getDataAsString('UTF-8');
        return JSON.parse(json);
      } catch (e) {
        // 壊れた state を空で返すと次回 saveState で空データが本保存され、実データが消える。
        // 安全側で throw し、操作をすべて失敗させて管理者に気付かせる。
        Logger.log('loadState(chunked) failed: ' + e.message);
        throw new Error('状態データが壊れています。スプシを確認するか、バックアップから復旧してください: ' + e.message);
      }
    }
    // マーカーはあるがチャンクがない → 空
    return emptyState(fiscalYear);
  }

  // レガシー形式（B1 にプレーン JSON）
  if (b1) {
    try {
      return JSON.parse(b1);
    } catch (e) {
      Logger.log('loadState(legacy) JSON.parse failed: ' + e.message + ' — returning empty');
      return emptyState(fiscalYear);
    }
  }

  return emptyState(fiscalYear);
}

function saveState(fiscalYear, state) {
  const ss = getStateSheet();
  const sheet = ss.getSheetByName('state') || ss.insertSheet('state');

  const json = JSON.stringify(state);
  const bytes = Utilities.newBlob(json, 'text/plain', 'state.json').getBytes();
  const encoded = Utilities.base64Encode(bytes);

  // 40000文字ずつ分割
  const chunks = [];
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push(''); // 空でも1チャンクは書く

  // メタ＋チャンクを一括書き込み（全行のセル値を配列で用意して setValues）
  const rows = Math.max(5, chunks.length);
  const values = [];
  const now = new Date().toISOString();
  for (let i = 0; i < rows; i++) {
    let a = '', b = '', c = '';
    if (i === 0)      { a = 'state';        b = CHUNK_MARKER; }
    else if (i === 1) { a = 'chunks';       b = chunks.length; }
    else if (i === 2) { a = 'lastUpdated';  b = state.lastUpdated || now; }
    else if (i === 3) { a = 'version';      b = state.version || 0; }
    else if (i === 4) { a = 'savedAt';      b = now; }
    if (i < chunks.length) c = chunks[i];
    values.push([a, b, c]);
  }
  sheet.getRange(1, 1, rows, 3).setValues(values);

  // 前回より行数が減った場合、余った行のゴミを消す
  const lastRow = sheet.getLastRow();
  if (lastRow > rows) {
    sheet.getRange(rows + 1, 1, lastRow - rows, 3).clearContent();
  }

  // 監査ログ
  try {
    const log = ss.getSheetByName('log') || ss.insertSheet('log');
    if (log.getLastRow() === 0) {
      log.appendRow(['timestamp', 'version', 'companies', 'confirmed', 'byteSize', 'base64Size', 'chunks']);
    }
    log.appendRow([
      now,
      state.version || 0,
      (state.companies || []).length,
      (state.assignments || []).filter(function(a) { return a.confirmed; }).length,
      json.length,
      encoded.length,
      chunks.length,
    ]);
  } catch (e) { Logger.log('log append failed: ' + e.message); }
}

/**
 * 診断用：現在保存されている state のサイズ情報を返す
 */
function diagState(fiscalYear) {
  const state = loadState(fiscalYear || 2026);
  const json = JSON.stringify(state);
  const encoded = Utilities.base64Encode(Utilities.newBlob(json).getBytes());
  return {
    version: state.version || 0,
    lastUpdated: state.lastUpdated,
    companies: (state.companies || []).length,
    assignments: (state.assignments || []).length,
    statusesTotal: (state.assignments || []).reduce(function(s, a) { return s + ((a.statuses || []).length); }, 0),
    confirmedCount: (state.assignments || []).filter(function(a) { return a.confirmed; }).length,
    jsonBytes: json.length,
    base64Bytes: encoded.length,
    chunksNeeded: Math.ceil(encoded.length / CHUNK_SIZE),
    cellLimitRoom: CHUNK_SIZE - (encoded.length % CHUNK_SIZE),
  };
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
    fiscalYear: fiscalYear,
    companies: [],
    assignments: [],
  };
}
