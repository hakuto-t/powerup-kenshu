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
    else if (action === 'diag') data = { ok: true, diag: diagState(+(e.parameter.year || 2026)) };
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
      // 同時タップが多いと 10秒では waitLock タイムアウトする。拒否されたクライアントでは
      // 楽観更新していた状態が剥がれ、タップが一瞬消えて見える問題の原因。30秒に延長。
      lock.waitLock(30000);
      // 'save'（state全上書き）は v5.3 で廃止：古いJSを開いたままの端末が他ユーザーの
      // 更新を潰してしまう事故があったため、差分エンドポイントのみ受け付ける。
      // 古いJSを掴んだブラウザにはエラーを返して「ブラウザを更新してください」と促す。
      if (action === 'save') throw new Error('このバージョンは古いため保存できません。ブラウザを強制リロード（Ctrl+F5）してください。');
      else if (action === 'addCompany') data = addCompanyHandler(body);
      else if (action === 'updateStatus') data = updateStatusHandler(body);
      else if (action === 'batchUpdateStatus') data = batchUpdateStatusHandler(body);
      else if (action === 'confirm') data = confirmHandler(body);
      else if (action === 'removeCompany') data = removeCompanyHandler(body);
      else if (action === 'setPassword') data = setPasswordHandler(body);
      else if (action === 'maintenance') data = maintenanceHandler(body);
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
  if (/ブラウザを.*リロード|古いため|古いJS/i.test(msg)) return msg;
  if (/状態.*壊|バックアップ|復旧/i.test(msg)) return msg;
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
    return liteOk(state, { duplicated: true, reason: '同名の会社が既に登録されています' });
  }
  if (state.companies.some(x => x.id === c.id)) {
    return liteOk(state, { duplicated: true });
  }
  // 規模制限（DoS対策）：会社数100まで
  if (state.companies.length >= 100) throw new Error('会社数の上限（100社）に達しました');
  state.companies.push(c);
  state.lastUpdated = new Date().toISOString();
  state.version = (state.version || 0) + 1;
  saveState(year, state);
  return liteOk(state);
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
  return liteOk(state);
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
  return liteOk(state);
}

/**
 * バッチで多数の updateStatus を一括適用する。CSV インポート等の大量書き込み用。
 * LockService を1回だけ取得して、loadState→全件更新→saveState を1トランザクションで実行。
 * body: { action: 'batchUpdateStatus', year, updates: [{companyId, cityId, ym, date, status}, ...] }
 */
function batchUpdateStatusHandler(body) {
  const year = +(body.year || 2026);
  const updates = body.updates || [];
  if (!Array.isArray(updates)) throw new Error('updates must be array');
  if (updates.length === 0) return { ok: true, applied: 0, skipped: 0, version: 0 };
  if (updates.length > 2000) throw new Error('batch too large (max 2000)');

  const state = loadState(year);
  let applied = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < updates.length; i++) {
    const u = updates[i];
    if (!u || !u.companyId || typeof u.companyId !== 'string' || u.companyId.length > 100) { skipped++; continue; }
    if (VALID_CITY_IDS.indexOf(u.cityId) < 0) { skipped++; continue; }
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(u.ym)) { skipped++; continue; }
    if (!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(u.date)) { skipped++; continue; }
    if (u.status && VALID_STATUSES.indexOf(u.status) < 0) { skipped++; continue; }

    const parts = u.ym.split('-');
    const y = +parts[0], m = +parts[1];
    let a = state.assignments.find(function(x) { return x.cityId === u.cityId && x.year === y && x.month === m; });
    if (!a) {
      a = { cityId: u.cityId, year: y, month: m, selectedDate: null, confirmed: false, statuses: [] };
      state.assignments.push(a);
    }
    const idx = a.statuses.findIndex(function(s) { return s.companyId === u.companyId && s.date === u.date; });
    if (u.status === 'UNKNOWN' || !u.status) {
      if (idx >= 0) a.statuses.splice(idx, 1);
    } else {
      const entry = { companyId: u.companyId, date: u.date, status: u.status, updatedAt: now };
      if (idx >= 0) a.statuses[idx] = entry; else a.statuses.push(entry);
    }
    applied++;
  }
  state.lastUpdated = now;
  state.version = (state.version || 0) + 1;
  saveState(year, state);
  return { ok: true, applied: applied, skipped: skipped, version: state.version, lastUpdated: now };
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
  return liteOk(state);
}

/**
 * v5.5: mutation レスポンスから state 全体（100KB+）を落としてネットワーク転送を高速化する。
 * クライアントは自分の楽観更新で UI は既に最新、他ユーザーの同時編集は
 * ポーリング（3秒）で取得する運用に切り替えた。
 */
function liteOk(state, extra) {
  const base = {
    ok: true,
    version: (state && state.version) || 0,
    lastUpdated: (state && state.lastUpdated) || null,
  };
  if (extra) for (const k in extra) base[k] = extra[k];
  return base;
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

/**
 * 管理者権限付きのメンテナンス呼び出し。
 * body: { action: 'maintenance', op: '<operation>', adminPw: '...' }
 * op: 'cleanupL2Duplicates'
 */
function maintenanceHandler(body) {
  if (!verifyAdmin(body.adminPw)) throw new Error('admin auth failed');
  const op = String(body.op || '');
  if (op === 'cleanupL2Duplicates') return cleanupL2Duplicates();
  if (op === 'addHL2ShiratoYusuke') return addHL2ShiratoYusuke();
  if (op === 'getInfo') return getSystemInfo();
  if (op === 'autoBackupNow') return autoBackupStateToDrive();
  if (op === 'setupAutoBackup') return setupDailyAutoBackupTrigger();
  if (op === 'removeAutoBackup') return removeDailyAutoBackupTrigger();
  if (op === 'listBackups') return listDriveBackups();
  throw new Error('unknown maintenance op: ' + op);
}

/**
 * システム情報を返す（スプシURLなど）。
 */
function getSystemInfo() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty('STATE_SHEET');
  const backupFolderId = props.getProperty('BACKUP_FOLDER_ID');
  const triggers = ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'autoBackupStateToDrive'; });
  return {
    ok: true,
    sheetId: sheetId,
    sheetUrl: sheetId ? ('https://docs.google.com/spreadsheets/d/' + sheetId + '/edit') : null,
    backupFolderId: backupFolderId,
    backupFolderUrl: backupFolderId ? ('https://drive.google.com/drive/folders/' + backupFolderId) : null,
    autoBackupTriggerCount: triggers.length,
    autoBackupNextRun: triggers.length > 0 ? '設定済み' : '未設定',
  };
}

/**
 * 【一回限り実行用】浜松L2 から 白都・悠資 を切り離す（L1 と同じ判断になるため重複を整理）。
 *   1. companies[白都,悠資] の cityParticipation から HL2 を削除
 *   2. HL2 assignments 配下の 白都・悠資 statuses をクリーンアップ（オーファン除去）
 *   3. 梅原（HL2+SZ）は変更しない
 * 実行後、フロント側は次回ロードで最新 state に追従する。
 */
function cleanupL2Duplicates() {
  const state = loadState(2026);
  const targets = state.companies
    .filter(function(c) {
      return (c.name === '白都' || c.name === '悠資') && (c.cityParticipation || []).indexOf('HL2') >= 0;
    })
    .map(function(c) { return { id: c.id, name: c.name }; });

  if (targets.length === 0) {
    Logger.log('cleanupL2Duplicates: 対象なし（既にクリーンアップ済み）');
    return { ok: true, removed: 0 };
  }
  const targetIds = targets.map(function(t) { return t.id; });

  // 1) cityParticipation から HL2 を外す
  state.companies.forEach(function(c) {
    if (targetIds.indexOf(c.id) >= 0) {
      c.cityParticipation = (c.cityParticipation || []).filter(function(x) { return x !== 'HL2'; });
    }
  });

  // 2) HL2 assignments のオーファン statuses を除去
  var orphanRemoved = 0;
  state.assignments.forEach(function(a) {
    if (a.cityId === 'HL2') {
      var before = (a.statuses || []).length;
      a.statuses = (a.statuses || []).filter(function(s) { return targetIds.indexOf(s.companyId) < 0; });
      orphanRemoved += (before - a.statuses.length);
    }
  });

  state.version = (state.version || 0) + 1;
  state.lastUpdated = new Date().toISOString();
  saveState(2026, state);

  Logger.log('cleanupL2Duplicates done. companies=' + targets.map(function(t){return t.name;}).join(',') + ' orphanStatusesRemoved=' + orphanRemoved);
  return { ok: true, removed: targets.length, orphanStatusesRemoved: orphanRemoved, newVersion: state.version };
}

/**
 * 【一回限り実行用】浜松L2 に 白都・悠資 を追加し、HL1 のスケジュールをそのままコピーする。
 * 梅原と合わせて L2 は 3名体制になる。
 *   1. companies[白都,悠資] の cityParticipation に 'HL2' を追加（重複追加しない）
 *   2. 既存の HL1 assignments の statuses（白都・悠資分）を HL2 assignments へコピー
 *      - 対応月の HL2 assignment がなければ新規作成
 *      - 既に同じ companyId+date の HL2 status があれば上書き
 *   3. 梅原の HL2 エントリは変更しない
 */
function addHL2ShiratoYusuke() {
  const state = loadState(2026);
  const targets = state.companies.filter(function(c) { return c.name === '白都' || c.name === '悠資'; });
  if (targets.length === 0) {
    Logger.log('addHL2ShiratoYusuke: 対象会社なし');
    return { ok: false, error: 'target companies not found' };
  }
  const targetIds = targets.map(function(c) { return c.id; });

  // 1) cityParticipation に HL2 を追加
  var companiesAdded = 0;
  targets.forEach(function(c) {
    c.cityParticipation = c.cityParticipation || [];
    if (c.cityParticipation.indexOf('HL2') < 0) {
      c.cityParticipation.push('HL2');
      companiesAdded++;
    }
  });

  // 2) HL1 → HL2 statuses コピー
  var copied = 0;
  var overwrote = 0;
  const hl1Assigns = state.assignments.filter(function(a) { return a.cityId === 'HL1'; });
  hl1Assigns.forEach(function(hl1) {
    var srcStatuses = (hl1.statuses || []).filter(function(s) { return targetIds.indexOf(s.companyId) >= 0; });
    if (srcStatuses.length === 0) return;
    var hl2 = state.assignments.find(function(a) { return a.cityId === 'HL2' && a.year === hl1.year && a.month === hl1.month; });
    if (!hl2) {
      hl2 = { cityId: 'HL2', year: hl1.year, month: hl1.month, selectedDate: null, confirmed: false, statuses: [] };
      state.assignments.push(hl2);
    }
    srcStatuses.forEach(function(src) {
      var idx = hl2.statuses.findIndex(function(s) { return s.companyId === src.companyId && s.date === src.date; });
      var entry = { companyId: src.companyId, date: src.date, status: src.status, updatedAt: src.updatedAt || new Date().toISOString() };
      if (idx >= 0) { hl2.statuses[idx] = entry; overwrote++; }
      else { hl2.statuses.push(entry); copied++; }
    });
  });

  state.version = (state.version || 0) + 1;
  state.lastUpdated = new Date().toISOString();
  saveState(2026, state);

  Logger.log('addHL2ShiratoYusuke done. companiesAdded=' + companiesAdded + ' copied=' + copied + ' overwrote=' + overwrote);
  return { ok: true, companiesAdded: companiesAdded, copied: copied, overwrote: overwrote, newVersion: state.version };
}

// ======================================================================
// 自動バックアップ（Drive保存・30日ローリング）
// ======================================================================

const BACKUP_FOLDER_NAME = 'エスト_パワーアップ研修_state_backups';
const BACKUP_RETAIN_DAYS = 30;

/**
 * バックアップ保存用 Drive フォルダを取得（なければ作成）。
 * スクリプトプロパティ BACKUP_FOLDER_ID にキャッシュ。
 */
function getOrCreateBackupFolder() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('BACKUP_FOLDER_ID');
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      Logger.log('既存 BACKUP_FOLDER_ID を開けず再生成: ' + e.message);
    }
  }
  const folder = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  Logger.log('バックアップフォルダ生成: ' + folder.getId() + ' (' + folder.getUrl() + ')');
  return folder;
}

/**
 * 現在の state を JSON で Drive に保存。30日超の古いバックアップを削除。
 * トリガーから毎日自動実行される想定。手動実行もOK。
 */
function autoBackupStateToDrive() {
  const t0 = new Date().getTime();
  const state = loadState(2026);
  const folder = getOrCreateBackupFolder();

  const now = new Date();
  const tz = 'Asia/Tokyo';
  const ts = Utilities.formatDate(now, tz, 'yyyy-MM-dd_HHmmss');
  const payload = {
    backedUpAt: now.toISOString(),
    year: 2026,
    state: state,
  };
  const fileName = 'state_' + ts + '.json';
  const file = folder.createFile(fileName, JSON.stringify(payload), 'application/json');
  Logger.log('backup saved: ' + fileName + ' (' + file.getSize() + ' bytes)');

  // 古いバックアップの削除（BACKUP_RETAIN_DAYS日より前）
  const cutoff = new Date(now.getTime() - BACKUP_RETAIN_DAYS * 86400000);
  const files = folder.getFilesByType('application/json');
  let removed = 0;
  while (files.hasNext()) {
    const f = files.next();
    if (f.getId() === file.getId()) continue;
    if (f.getDateCreated().getTime() < cutoff.getTime()) {
      f.setTrashed(true);
      removed++;
    }
  }

  const dt = (new Date().getTime() - t0) / 1000;
  return {
    ok: true,
    fileName: fileName,
    fileId: file.getId(),
    fileUrl: file.getUrl(),
    sizeBytes: file.getSize(),
    version: state.version,
    removedOldBackups: removed,
    elapsedSec: dt,
  };
}

/**
 * 毎日 JST 午前3時に autoBackupStateToDrive を実行するトリガーを作成。
 * 既存の autoBackupStateToDrive トリガーは事前に削除。
 */
function setupDailyAutoBackupTrigger() {
  removeDailyAutoBackupTrigger();
  const trigger = ScriptApp.newTrigger('autoBackupStateToDrive')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();
  // 登録後、初回のバックアップを即座に実行
  const first = autoBackupStateToDrive();
  return {
    ok: true,
    triggerId: trigger.getUniqueId(),
    schedule: '毎日 JST 03:00 に autoBackupStateToDrive を実行',
    firstBackup: first,
  };
}

function removeDailyAutoBackupTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'autoBackupStateToDrive') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return { ok: true, removedTriggers: removed };
}

/**
 * Drive 内のバックアップ一覧を返す。
 */
function listDriveBackups() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('BACKUP_FOLDER_ID');
  if (!folderId) return { ok: true, folderExists: false, backups: [] };
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByType('application/json');
  const list = [];
  while (files.hasNext()) {
    const f = files.next();
    list.push({
      name: f.getName(),
      id: f.getId(),
      url: f.getUrl(),
      size: f.getSize(),
      created: Utilities.formatDate(f.getDateCreated(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
    });
  }
  list.sort(function(a, b) { return b.name.localeCompare(a.name); });
  return { ok: true, folderExists: true, folderUrl: folder.getUrl(), count: list.length, backups: list };
}
