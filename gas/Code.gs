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

function doGet(e) {
  const action = (e.parameter.action || 'bootstrap');
  try {
    let data;
    if (action === 'bootstrap') data = bootstrapHandler(e);
    else if (action === 'state') data = stateHandler(e);
    else throw new Error('unknown action: ' + action);
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
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
      else throw new Error('unknown action: ' + action);
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function bootstrapHandler(e) {
  const year = +(e.parameter.year || 2026);
  const months = buildMonthsForYear(year);
  const state = loadState(year);
  // 明示的に companies/assignments を含めて返す（クライアント互換のため）
  return {
    ok: true,
    fiscalYear: year,
    months,
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
  return { ok: true, state, lastUpdated: state.lastUpdated, version: state.version || 0, changed };
}

function saveHandler(body) {
  const year = +(body.year || 2026);
  const incoming = body.state || {};
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
  if (!body.company || !body.company.id || !body.company.name) throw new Error('company.id と name が必要');
  // 重複防止
  if (state.companies.some(c => c.id === body.company.id)) {
    return { ok: true, state, duplicated: true };
  }
  state.companies.push(body.company);
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
  if (!companyId || !cityId || !ym || !date) throw new Error('必須パラメータが不足');
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
  if (!cityId || !ym) throw new Error('必須パラメータが不足');
  const [y, m] = ym.split('-').map(Number);
  const state = loadState(year);
  let a = state.assignments.find(x => x.cityId === cityId && x.year === y && x.month === m);
  if (!a) {
    a = { cityId, year: y, month: m, selectedDate: null, confirmed: false, statuses: [] };
    state.assignments.push(a);
  }
  if (unconfirm) {
    a.confirmed = false;
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

  // 他研修スプシ疎通確認
  let monthsCount = 0;
  try {
    const months = buildMonthsForYear(2026);
    monthsCount = months.length;
  } catch (e) {
    Logger.log('他研修スプシ読み取りエラー: ' + e.message);
  }

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
