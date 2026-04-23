/**
 * エスト パワーアップ研修 年間日程調整ツール — GAS Web App
 *
 * エンドポイント（Webアプリとしてデプロイ後、/exec に対してGET/POST）
 *
 * GET  ?action=bootstrap&year=2026  → MonthData[] と AppState を統合
 * GET  ?action=state&year=2026&since=<iso>&sinceVersion=<n> → 差分があれば AppState
 * POST {action: 'save'|'addCompany'|'updateStatus'|'confirm'|'removeCompany', ...}
 *
 * スクリプトプロパティで設定：
 *   OTHER_SHEET_2026     ... 他研修スプシ2026年のID
 *   OTHER_SHEET_2027     ... 他研修スプシ2027年のID
 *   STATE_SHEET          ... 状態保存スプシのID
 *   ADMIN_PASSWORD_HASH  ... 管理者パスワードの SHA-256 hex ハッシュ
 *                            （hashAdminPassword() を一度実行して取得・貼り付け）
 *   ADMIN_PASSWORD       ... 互換：平文の管理者パスワード（HASH未設定時のフォールバック）
 */

// 入力バリデーション用ホワイトリスト
const VALID_CITY_IDS = ['HL1', 'HL2', 'SZ', 'YH', 'UT'];
const VALID_STATUSES = ['OK', 'MAYBE', 'NG', 'UNKNOWN'];

function doGet(e) {
  const action = (e.parameter.action || 'bootstrap');
  try {
    let data;
    if (action === 'bootstrap') data = bootstrapHandler(e);
    else if (action === 'state') data = stateHandler(e);
    else throw new Error('unknown action: ' + action);
    return jsonResponse(data);
  } catch (err) {
    Logger.log('doGet error: ' + err.stack);
    return jsonResponse({ ok: false, error: safeErrMsg(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;
    // 書き込み系は LockService で直列化（スプシ並行書き込み競合を防ぐ）
    const lock = LockService.getScriptLock();
    let data;
    try {
      lock.waitLock(10000);
      if (action === 'save') data = saveHandler(body);
      else if (action === 'addCompany') data = addCompanyHandler(body);
      else if (action === 'updateStatus') data = updateStatusHandler(body);
      else if (action === 'confirm') data = confirmHandler(body);
      else if (action === 'removeCompany') data = removeCompanyHandler(body);
      else if (action === 'setPassword') data = setPasswordHandler(body);
      else throw new Error('unknown action: ' + action);
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
    return jsonResponse(data);
  } catch (err) {
    Logger.log('doPost error: ' + err.stack);
    return jsonResponse({ ok: false, error: safeErrMsg(err) });
  }
}

/**
 * エラーメッセージを「認証系」「検証系」だけ残してそれ以外は汎用化
 */
function safeErrMsg(err) {
  const msg = String(err && err.message || err);
  if (/admin auth|admin authentication|認証/i.test(msg)) return msg;
  if (/不正|invalid|必要|required|範囲|range/i.test(msg)) return msg;
  if (/unknown action/i.test(msg)) return msg;
  return 'サーバーエラーが発生しました';
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function bootstrapHandler(e) {
  const year = +(e.parameter.year || 2026);
  // 他研修スプシとの接続は切断済み。クライアント側 other-trainings.json から月データを構築する。
  // （旧: const months = buildMonthsForYear(year); でスプシ読み取り → v5 で廃止）
  const state = loadState(year);
  return {
    ok: true,
    fiscalYear: year,
    state,
    companies: state.companies || [],
    assignments: state.assignments || [],
    lastUpdated: state.lastUpdated || new Date().toISOString(),
    version: state.version || 0,
  };
}

function stateHandler(e) {
  const year = +(e.parameter.year || 2026);
  const since = e.parameter.since;
  const sinceVersion = e.parameter.sinceVersion != null ? +e.parameter.sinceVersion : null;
  const lite = e.parameter.lite === '1';
  const state = loadState(year);
  // version 優先で変更判定（ミリ秒精度に依存しない）
  let changed;
  if (sinceVersion !== null && !isNaN(sinceVersion)) {
    changed = (state.version || 0) > sinceVersion;
  } else if (since) {
    changed = state.lastUpdated > since;
  } else {
    changed = true;
  }
  // 軽量モード: 変更がない場合は state を含めない（帯域削減・ GAS 実行時間短縮）
  if (lite && !changed) {
    return { ok: true, changed: false, lastUpdated: state.lastUpdated, version: state.version || 0 };
  }
  return { ok: true, state, lastUpdated: state.lastUpdated, version: state.version || 0, changed };
}

function saveHandler(body) {
  const year = +(body.year || 2026);
  const incoming = body.state || {};
  if (!incoming || typeof incoming !== 'object') throw new Error('state が必要');
  // DoS対策：state JSON サイズ制限
  const size = JSON.stringify(incoming).length;
  if (size > 500000) throw new Error('state サイズが大きすぎます（' + size + ' bytes）');
  // version 単調増加の保証
  const current = loadState(year);
  incoming.version = Math.max((current.version || 0) + 1, (incoming.version || 0));
  incoming.lastUpdated = new Date().toISOString();
  saveState(year, incoming);
  return { ok: true, state: loadState(year) };
}

function addCompanyHandler(body) {
  const year = +(body.year || 2026);
  const state = loadState(year);
  const c = body.company;
  if (!c || typeof c !== 'object') throw new Error('company が必要');
  if (!c.id || typeof c.id !== 'string' || c.id.length > 100) throw new Error('不正な company.id');
  if (!c.name || typeof c.name !== 'string' || c.name.length > 200) throw new Error('不正な company.name');
  // 名前の重複チェック（軽量なスパム対策）
  if (state.companies.some(x => x.name === c.name)) {
    return { ok: true, state, duplicated: true, reason: '同名の会社が既に登録されています' };
  }
  if (state.companies.some(x => x.id === c.id)) {
    return { ok: true, state, duplicated: true };
  }
  // 規模制限（DoS対策）：会社数100まで
  if (state.companies.length >= 100) throw new Error('会社数の上限（100社）に達しました');
  state.companies.push(c);
  state.lastUpdated = new Date().toISOString();
  state.version = (state.version || 0) + 1;
  saveState(year, state);
  return { ok: true, state };
}

function removeCompanyHandler(body) {
  if (!verifyAdmin(body.adminPw)) throw new Error('admin auth failed');
  const year = +(body.year || 2026);
  const state = loadState(year);
  state.companies = state.companies.filter(c => c.id !== body.companyId);
  state.assignments = state.assignments.map(a => ({
    ...a,
    statuses: (a.statuses || []).filter(s => s.companyId !== body.companyId),
  }));
  state.lastUpdated = new Date().toISOString();
  state.version = (state.version || 0) + 1;
  saveState(year, state);
  return { ok: true, state };
}

function updateStatusHandler(body) {
  const year = +(body.year || 2026);
  const { companyId, cityId, ym, date, status } = body;
  // 入力バリデーション
  if (!companyId || typeof companyId !== 'string' || companyId.length > 100) throw new Error('不正な companyId');
  if (!VALID_CITY_IDS.includes(cityId)) throw new Error('不正な cityId');
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(ym)) throw new Error('不正な ym 形式');
  if (!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) throw new Error('不正な date 形式');
  if (status && !VALID_STATUSES.includes(status)) throw new Error('不正な status');
  const [y, m] = ym.split('-').map(Number);
  const state = loadState(year);
  let a = state.assignments.find(x => x.cityId === cityId && x.year === y && x.month === m);
  if (!a) {
    a = { cityId, year: y, month: m, selectedDate: null, confirmed: false, statuses: [] };
    state.assignments.push(a);
  }
  const idx = a.statuses.findIndex(s => s.companyId === companyId && s.date === date);
  if (status === 'UNKNOWN') {
    if (idx >= 0) a.statuses.splice(idx, 1);
  } else {
    const entry = { companyId, date, status, updatedAt: new Date().toISOString() };
    if (idx >= 0) a.statuses[idx] = entry; else a.statuses.push(entry);
  }
  state.lastUpdated = new Date().toISOString();
  state.version = (state.version || 0) + 1;
  saveState(year, state);
  return { ok: true, state };
}

function confirmHandler(body) {
  const year = +(body.year || 2026);
  const { cityId, ym, date, adminPw, unconfirm } = body;
  if (unconfirm && !verifyAdmin(adminPw)) throw new Error('admin auth failed');
  if (!VALID_CITY_IDS.includes(cityId)) throw new Error('不正な cityId');
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(ym)) throw new Error('不正な ym 形式');
  if (date && !/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) throw new Error('不正な date 形式');
  const [y, m] = ym.split('-').map(Number);
  const state = loadState(year);
  let a = state.assignments.find(x => x.cityId === cityId && x.year === y && x.month === m);
  if (!a) {
    a = { cityId, year: y, month: m, selectedDate: null, confirmed: false, statuses: [] };
    state.assignments.push(a);
  }
  if (unconfirm) {
    a.confirmed = false;
    a.selectedDate = null;
  } else {
    if (!date) throw new Error('date が必要');
    a.selectedDate = date;
    a.confirmed = true;
  }
  state.lastUpdated = new Date().toISOString();
  state.version = (state.version || 0) + 1;
  saveState(year, state);
  return { ok: true, state };
}

/**
 * 管理者パスワード検証。
 * ADMIN_PASSWORD_HASH（SHA-256 hex）が設定されていればそれで検証、
 * なければ平文 ADMIN_PASSWORD にフォールバック（非推奨）。
 */
/**
 * 現パスワード認証で新パスワードに上書きする API
 * body: { action: 'setPassword', currentAdminPw, newPw }
 */
function setPasswordHandler(body) {
  if (!verifyAdmin(body.currentAdminPw)) throw new Error('admin auth failed');
  const newPw = String(body.newPw || '');
  if (newPw.length < 1) throw new Error('newPw required');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_PASSWORD_HASH', sha256Hex(newPw));
  props.deleteProperty('ADMIN_PASSWORD');
  return { ok: true, message: 'パスワードを更新しました' };
}

function verifyAdmin(pw) {
  if (!pw) return false;
  const props = PropertiesService.getScriptProperties();
  const hash = props.getProperty('ADMIN_PASSWORD_HASH');
  if (hash) return sha256Hex(pw) === hash.toLowerCase();
  const plain = props.getProperty('ADMIN_PASSWORD');
  return !!plain && pw === plain;
}

function sha256Hex(s) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return raw.map(b => ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2)).join('');
}

/**
 * 【初回1回だけ実行】
 * この関数を実行すると：
 *   1. Google にスコープ承認を求められる → 「許可」で完了
 *   2. 状態保存スプシを自動生成しIDをスクリプトプロパティに保存
 *   3. 他研修スプシの読み取り疎通を確認
 *   4. Web App URL が有効化される
 *
 * 実行手順：
 *   1. 画面上部の関数ドロップダウンで「oneTimeSetup」を選択
 *   2. ▶ 実行 ボタンをクリック
 *   3. 権限ダイアログで hakuto.t@... のアカウントを選び「許可」をクリック
 *      （「確認されていません」警告が出ても、詳細→安全でないページへ進み 許可）
 *   4. 実行ログに「セットアップ完了」と出れば成功
 */
function oneTimeSetup() {
  const ss = getStateSheet();
  const ssUrl = ss.getUrl();
  const ssId = ss.getId();

  // v5以降、他研修スプシとの接続は切断（クライアント側JSON固定運用）
  const monthsCount = 0;

  // デフォルトの管理者パスワードハッシュを設定（初回のみ、既存は変更しない）
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PASSWORD_HASH') && !props.getProperty('ADMIN_PASSWORD')) {
    const defaultPw = 'admin1234';
    props.setProperty('ADMIN_PASSWORD_HASH', sha256Hex(defaultPw));
    Logger.log('デフォルト管理者パスワードを設定: ' + defaultPw + '（後で setAdminPassword で変更可）');
  }

  Logger.log('=== セットアップ完了 ===');
  Logger.log('状態保存スプシ: ' + ssUrl);
  Logger.log('状態保存スプシID: ' + ssId);
  Logger.log('月データ数（2026年度 11月分+休講1月）: ' + monthsCount);
  Logger.log('Web App は有効化されました。');
  return { ok: true, ssUrl, ssId, monthsCount };
}

/**
 * 管理者パスワードを変更する（コンソールから実行）
 *   setAdminPassword の pw をお好みのパスワードに変更 → 実行 → OK
 */
function setAdminPassword() {
  const pw = 'change-me-please'; // ← ここを変更してから実行
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', sha256Hex(pw));
  PropertiesService.getScriptProperties().deleteProperty('ADMIN_PASSWORD');
  Logger.log('管理者パスワードを更新しました');
}
