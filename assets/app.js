/* app.js — 起動・状態管理・イベントバインディング */
(function (root) {
  'use strict';

  const CLIENT_VERSION = 'v5.4';   // 古いブラウザキャッシュを検出するためのクライアント版。JSを変更したら更新すること
  const POLL_INTERVAL_MS = 5000;   // 5秒（GASクォータ削減、体感は許容範囲）
  const ADMIN_SESSION_MS = 30 * 60 * 1000; // 管理者セッション有効期限 30分
  console.log('[powerup-kenshu] client version:', CLIENT_VERSION);

  const App = {
    // 状態
    cities: [],
    rules: {},
    ozawaRange: null,
    state: null, // { version, lastUpdated, companies[], assignments[] }
    monthsData: [], // サーバから or フォールバック計算した DayData 配列

    currentCityId: 'HL1',
    currentMonthKey: '2026-08',
    selectedDate: null,

    pollTimer: null,

    async init() {
      // 1) マスタデータを読み込み
      const [citiesRes, rulesRes, ozRes, presetRes, otRes] = await Promise.all([
        fetch('./assets/data/cities.json').then(r => r.json()),
        fetch('./assets/data/rules.json').then(r => r.json()),
        fetch('./assets/data/ozawa-range.json').then(r => r.json()),
        fetch('./assets/data/companies-preset.json').then(r => r.json()).catch(() => ({ companies: [] })),
        fetch('./assets/data/other-trainings.json').then(r => r.json()).catch(() => ({ days: {} })),
      ]);
      App.cities = citiesRes.cities;
      App.rules = rulesRes;
      App.ozawaRange = ozRes;
      App.presetCompanies = (presetRes && presetRes.companies) || [];
      App.otherTrainings = (otRes && otRes.days) || {};

      // 2) バックエンドから状態ロード（失敗したらLocalStorage→空）
      await App.loadState();

      // 3) 月データをフロント側で構築（バックエンドがない時のフォールバック）
      App.monthsData = App.buildMonthsData();

      // 4) UI初期化
      App.renderCityTabs();
      App.renderMonthJump();
      App.renderAll();

      // 5) イベントバインド
      App.bindEvents();

      // 6) ポーリング開始（バックエンド接続時のみ）
      if (root.Api.hasBackend()) {
        App.startPolling();
      } else {
        const si = document.getElementById('sync-indicator');
        if (si) { si.classList.add('offline'); si.querySelector('.label').textContent = 'ローカルのみ'; }
      }

      // 7) bfcache / タブ復帰対策：戻るボタン等でキャッシュから復元されたタブは、
      //    古い state のまま操作を続けると他ユーザーの変更を上書きする恐れがある。
      //    pageshow.persisted=true の場合と、visibilitychange で表示状態に戻ったときに
      //    state を強制再同期する。
      window.addEventListener('pageshow', (e) => {
        if (e.persisted) {
          console.log('[powerup-kenshu] pageshow from bfcache — refetching state');
          App._refetchState();
        }
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && root.Api.hasBackend()) {
          // タブに戻ってきたら即座にポーリングして同期
          App._pollOnce();
        }
      });
    },

    // 単発ポーリング（pageshow / visibilitychange から即時同期するため）
    async _pollOnce() {
      try {
        const res = await root.Api.pollState(App.state.lastUpdated, App.state.version);
        App._setSyncIndicator(true, '接続中');
        if (res && res.changed && res.state && (res.state.version || 0) > (App.state.version || 0)) {
          App.state = res.state;
          App.saveLocal();
          App.renderAll();
        }
      } catch (e) {
        App._setSyncIndicator(false, 'オフライン');
      }
    },

    async loadState() {
      let state = null;
      let online = false;
      if (root.Api.hasBackend()) {
        try {
          const boot = await root.Api.getBootstrap();
          if (boot && boot.state) state = boot.state;
          if (boot && boot.months) App._serverMonths = boot.months;
          online = !!boot;
        } catch (e) {
          console.warn('bootstrap failed, falling back to local', e);
          App._setSyncIndicator(false, 'オフライン（ローカル表示のみ）');
        }
      }
      if (!state) state = root.Storage.loadState();
      if (!state) state = { version: 0, lastUpdated: new Date().toISOString(), companies: [], assignments: [] };
      App.state = state;
      App._onlineAtBoot = online;
    },

    _setSyncIndicator(isOnline, label) {
      const si = document.getElementById('sync-indicator');
      if (!si) return;
      if (isOnline) si.classList.remove('offline'); else si.classList.add('offline');
      const lbl = si.querySelector('.label');
      if (lbl) lbl.textContent = label || (isOnline ? '接続中' : 'オフライン');
    },

    saveLocal() {
      root.Storage.saveState(App.state);
    },

    async persist() {
      // ※ 全体保存（saveState）はもはや使わない：他ユーザーの同時編集を潰してしまうため。
      //   各操作は差分エンドポイント（addCompany/removeCompany/updateStatus/confirm）で送る。
      //   万一バックエンド未接続時の保険として、ローカル保存だけは残す。
      App.saveLocal();
    },

    // サーバーから返った state をクライアント側に反映するか判断する共通ヘルパー。
    // レスポンスが順不同で返っても古い state で新しいローカル state を潰さないよう、
    // 受け取った state の version が手元より前進しているときだけ採用する。
    // 戻り値: 'applied' | 'skipped' | 'rejected'
    _applyServerResponse(res) {
      if (!res) return 'skipped';
      // エラー応答（ok:false）はサーバー側でリジェクトされている。
      if (res.ok === false) {
        App.toast('保存できませんでした：' + (res.error || 'サーバーエラー。ブラウザを更新してください'), 'error');
        return 'rejected';
      }
      if (!res.state) return 'skipped';
      const localV = App.state.version || 0;
      const serverV = res.state.version || 0;
      if (serverV > localV) {
        App.state = res.state;
        App.saveLocal();
        return 'applied';
      }
      return 'skipped';
    },

    // サーバーに reject されたとき、またはネットワークエラーでローカル state が先走って
    // いるとき、サーバーから最新 state を取り直して差し戻す。これをしないと
    // local/server が乖離してポーリングでも同期されなくなる。
    async _refetchState() {
      if (!root.Api.hasBackend()) return false;
      try {
        const boot = await root.Api.getBootstrap();
        if (boot && boot.state) {
          App.state = boot.state;
          App.saveLocal();
          App.renderAll();
          return true;
        }
      } catch (e) {
        App._setSyncIndicator(false, 'オフライン');
      }
      return false;
    },

    // 月データ構築：フロント側 other-trainings.json + ozawa-range.json から計算する（v5以降、他研修スプシからは切断）。
    // App._serverMonths は互換のため残しているが、通常は空で本分岐は常にフォールバックする。
    buildMonthsData() {
      if (App._serverMonths) return App._serverMonths;
      const out = [];
      const ranges = App.ozawaRange.ranges;
      for (const key of Object.keys(ranges).sort()) {
        const [y, m] = key.split('-').map(Number);
        const range = ranges[key];
        if (!range) { out.push({ year: y, month: m, ozawaRange: null, days: [], skip: true }); continue; }
        const lastDay = new Date(y, m, 0).getDate();
        const days = [];
        for (let d = 1; d <= lastDay; d++) {
          const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const inRange = iso >= range.start && iso <= range.end;
          const ot = App.otherTrainings[iso] || {};
          days.push({
            date: iso,
            weekday: new Date(iso + 'T00:00:00+09:00').getDay(),
            holiday: ot.holiday || null,
            inCandidateRange: inRange,
            otherPrograms: ot.otherPrograms || [],
          });
        }
        out.push({ year: y, month: m, ozawaRange: range, days });
      }
      return out;
    },

    getCurrentMonthData() {
      const [y, m] = App.currentMonthKey.split('-').map(Number);
      return App.monthsData.find(md => md.year === y && md.month === m);
    },

    getAssignment(cityId, year, month) {
      return App.state.assignments.find(a => a.cityId === cityId && a.year === year && a.month === month);
    },

    ensureAssignment(cityId, year, month) {
      let a = App.getAssignment(cityId, year, month);
      if (!a) {
        a = { cityId, year, month, selectedDate: null, confirmed: false, statuses: [] };
        App.state.assignments.push(a);
      }
      return a;
    },

    getOtherConfirmedByDate() {
      // 現在の都市以外で確定済みの (date → {cityId, cityName})
      const map = {};
      for (const a of App.state.assignments) {
        if (a.cityId === App.currentCityId) continue;
        if (!a.confirmed || !a.selectedDate) continue;
        const city = App.cities.find(c => c.id === a.cityId);
        map[a.selectedDate] = { cityId: a.cityId, cityName: city ? city.name : a.cityId };
      }
      return map;
    },

    // ------- レンダリング -------
    renderCityTabs() {
      const el = document.getElementById('city-tabs');
      const tabs = App.cities.map(c => {
        const confirmedCount = App.state.assignments.filter(a => a.cityId === c.id && a.confirmed).length;
        return `<button class="city-tab ${c.id === App.currentCityId ? 'active' : ''}" data-city="${c.id}">
          <span class="ct-dot" style="background:${c.color}"></span>
          <span>${c.name}</span>
          <span class="ct-progress">${confirmedCount}/11</span>
        </button>`;
      }).join('');
      el.innerHTML = tabs;
      el.querySelectorAll('.city-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          App.currentCityId = btn.dataset.city;
          App.selectedDate = null;
          // 都市タブを切り替えたら、参加会社一覧もその都市だけ展開
          if (root.UICompanyEntry && root.UICompanyEntry.setCurrentCityForCollapse) {
            root.UICompanyEntry.setCurrentCityForCollapse(App.currentCityId);
          }
          App.renderAll();
        });
      });
    },

    renderMonthJump() {
      const el = document.getElementById('month-jump');
      const keys = Object.keys(App.ozawaRange.ranges).sort();
      el.innerHTML = keys.map(k => {
        const skip = App.ozawaRange.skipMonths.includes(k);
        const active = k === App.currentMonthKey;
        const [, m] = k.split('-');
        const label = `${+m}月`;
        return `<button class="month-pill ${active ? 'active' : ''} ${skip ? 'skip' : ''}" data-key="${k}" ${skip ? 'disabled' : ''}>${label}</button>`;
      }).join('');
      el.querySelectorAll('.month-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.classList.contains('skip')) return;
          App.currentMonthKey = btn.dataset.key;
          App.selectedDate = null;
          App.renderAll();
        });
      });
    },

    renderAll() {
      // 月タブ・都市タブの active 反映
      App.renderMonthJump();

      // 月ラベル更新
      const monthData = App.getCurrentMonthData();
      const [y, m] = App.currentMonthKey.split('-').map(Number);
      document.getElementById('month-label').textContent = `${y}年${m}月`;
      if (monthData && monthData.skip) {
        document.getElementById('month-label').textContent += '（小澤さん休講月）';
      }

      // 進捗
      const confirmed = App.state.assignments.filter(a => a.confirmed).length;
      document.getElementById('progress-done').textContent = confirmed;
      document.getElementById('progress-fill').style.width = `${(confirmed / 11) * 100}%`;

      // カレンダー（ranked/suggestions は1回だけ計算してキャッシュ、サイドパネルからも参照）
      const ownAssign = App.getAssignment(App.currentCityId, y, m);
      const ranked = monthData && !monthData.skip
        ? Scheduler.rankCandidates(monthData, App.currentCityId, App.state.companies, App.state.assignments, App.rules.soft)
        : [];
      const suggestions = monthData && !monthData.skip
        ? Scheduler.suggestCompromises(monthData, App.currentCityId, App.state.companies, App.state.assignments, App.rules.soft, 3)
        : [];
      const otherConfirmedByDate = App.getOtherConfirmedByDate();
      App._computed = { monthData, ownAssign, ranked, suggestions, otherConfirmedByDate };
      const calEl = document.getElementById('calendar');
      UICalendar.render(calEl, monthData, {
        cityId: App.currentCityId,
        assignments: App.state.assignments,
        ranked,
        suggestions,
        selectedDate: App.selectedDate,
        ownAssignment: ownAssign,
        otherConfirmedByDate,
        onCellClick: (iso) => {
          App.selectedDate = iso;
          App.renderSidePanel();
          App.renderCalendarOnly();
        },
      });

      // サイドパネル
      App.renderSidePanel();

      // 会社テーブル（都市別アコーディオン）
      UICompanyEntry.renderCompaniesTable(document.getElementById('companies-table'), {
        companies: App.state.companies,
        cities: App.cities,
        assignments: App.state.assignments,
        isAdmin: root.Storage.isAdmin(),
        currentMonth: monthData,
        currentCityId: App.currentCityId,
        onStatusToggle: (companyId, cityId, date, next) => App.updateStatus(companyId, cityId, date, next),
        onRemove: (companyId) => App.removeCompany(companyId),
      });

      // 都市タブの進捗
      App.renderCityTabs();

      // 年間ミニマップ
      App.renderMinimap();
    },

    renderCalendarOnly() {
      // キャッシュがあれば使う、なければ renderAll に任せる
      const cached = App._computed;
      if (!cached || !cached.monthData) { App.renderAll(); return; }
      UICalendar.render(document.getElementById('calendar'), cached.monthData, {
        cityId: App.currentCityId,
        assignments: App.state.assignments,
        ranked: cached.ranked,
        suggestions: cached.suggestions,
        selectedDate: App.selectedDate,
        ownAssignment: cached.ownAssign,
        otherConfirmedByDate: cached.otherConfirmedByDate,
        onCellClick: (iso) => {
          App.selectedDate = iso;
          App.renderSidePanel();
          App.renderCalendarOnly();
        },
      });
    },

    renderSidePanel() {
      const panel = document.getElementById('side-panel');
      if (!App.selectedDate) {
        UISidePanel.renderEmpty(panel);
        return;
      }
      // renderAll() で計算したキャッシュを再利用（重複計算回避）
      const cached = App._computed || {};
      const monthData = cached.monthData || App.getCurrentMonthData();
      const ownAssign = cached.ownAssign;
      const ranked = cached.ranked || [];
      const suggestions = cached.suggestions || [];
      const rank = ranked.find(r => r.date === App.selectedDate);
      const otherConfirmed = (cached.otherConfirmedByDate || {})[App.selectedDate];
      const city = App.cities.find(c => c.id === App.currentCityId);

      UISidePanel.render(panel, {
        date: App.selectedDate,
        rank,
        monthData,
        cityId: App.currentCityId,
        cityName: city ? city.name : App.currentCityId,
        companies: App.state.companies,
        assignments: App.state.assignments,
        suggestions,
        isConfirmed: !!(ownAssign && ownAssign.confirmed && ownAssign.selectedDate === App.selectedDate),
        isAdmin: root.Storage.isAdmin(),
        otherCityInfo: otherConfirmed,
        onStatusChange: (cid, date, next) => App.updateStatus(cid, App.currentCityId, date, next),
        onConfirm: (date) => App.confirmDate(date),
        onUnconfirm: () => App.unconfirmDate(),
      });
    },

    renderMinimap() {
      const el = document.getElementById('year-minimap');
      if (!el) return;
      const parent = el.parentElement;

      // 全月キー（2月を除外した実施月のみ）
      const allKeys = Object.keys(App.ozawaRange.ranges).sort();
      const activeKeys = allKeys.filter(k => !App.ozawaRange.skipMonths.includes(k));

      const totalSlots = App.cities.length * activeKeys.length;
      const confirmedCount = App.state.assignments.filter(a => a.confirmed).length;
      const pendingCount = totalSlots - confirmedCount;

      // サマリを挿入
      const prevSummary = parent.querySelector('.minimap-summary');
      if (prevSummary) prevSummary.remove();
      const summary = document.createElement('div');
      summary.className = 'minimap-summary';
      summary.innerHTML = `
        <div class="ms-item"><span class="ms-count">${confirmedCount}</span>/ ${totalSlots} 確定</div>
        <div class="ms-item"><span class="ms-count">${pendingCount}</span>未定</div>
        <div class="ms-legend">
          <span><span class="sw c"></span>確定</span>
          <span><span class="sw p"></span>未定</span>
          <span><span class="sw s"></span>休講（2月）</span>
        </div>`;
      parent.insertBefore(summary, el);

      // 縦軸=月、横軸=都市 の構造に変更（2月行は「休講」として1セルだけ示す）
      // テーブル構造で出力（gridから変更）
      const thead = `<thead><tr>
        <th class="mm-th-month">月</th>
        ${App.cities.map(c => `<th class="mm-th-city">
          <span class="city-dot" style="background:${c.color}"></span>${c.name}
        </th>`).join('')}
      </tr></thead>`;

      const rows = allKeys.map(k => {
        const [y, m] = k.split('-').map(Number);
        const skip = App.ozawaRange.skipMonths.includes(k);
        if (skip) {
          return `<tr class="mm-row-skip">
            <th class="mm-th-month">${y}年${m}月</th>
            <td colspan="${App.cities.length}" class="mm-cell-skip">小澤さん休講月（研修なし）</td>
          </tr>`;
        }
        const cells = App.cities.map(c => {
          const a = App.getAssignment(c.id, y, m);
          if (a && a.confirmed && a.selectedDate) {
            const d = new Date(a.selectedDate + 'T00:00:00+09:00');
            const wd = '日月火水木金土'[d.getDay()];
            return `<td class="mm-cell confirmed" title="${a.selectedDate}（${c.name}）">
              <div class="mm-date">${d.getMonth() + 1}/${d.getDate()}</div>
              <div class="mm-wd">${wd}</div>
            </td>`;
          }
          return `<td class="mm-cell pending" title="未定">—</td>`;
        }).join('');
        return `<tr>
          <th class="mm-th-month">${y}年${m}月</th>
          ${cells}
        </tr>`;
      }).join('');

      el.innerHTML = `<table class="mm-table">${thead}<tbody>${rows}</tbody></table>`;
    },

    // ------- 操作系 -------
    async updateStatus(companyId, cityId, date, next) {
      const [y, m] = [+date.slice(0, 4), +date.slice(5, 7)];
      // 1) ローカル楽観更新（即座にUIへ反映）
      const a = App.ensureAssignment(cityId, y, m);
      const idx = a.statuses.findIndex(s => s.companyId === companyId && s.date === date);
      if (next === 'UNKNOWN') {
        if (idx >= 0) a.statuses.splice(idx, 1);
      } else {
        const entry = { companyId, date, status: next, updatedAt: new Date().toISOString() };
        if (idx >= 0) a.statuses[idx] = entry;
        else a.statuses.push(entry);
      }
      App.state.lastUpdated = new Date().toISOString();
      App.state.version = (App.state.version || 0) + 1;
      App.saveLocal();
      App.renderAll();
      // 2) サーバーには差分のみ送る（全上書きしない → 他人の同時編集を潰さない）
      if (!root.Api.hasBackend()) return;
      try {
        const ym = `${y}-${String(m).padStart(2, '0')}`;
        const res = await root.Api.updateStatus({ companyId, cityId, ym, date, status: next });
        const r = App._applyServerResponse(res);
        if (r === 'applied') App.renderAll();
        else if (r === 'rejected') {
          // サーバーが拒否した場合、ローカルで先走った state を最新に差し戻す
          await App._refetchState();
        }
      } catch (e) {
        App.toast('保存エラー（ローカル保存は済・同期を取り直し）: ' + e.message, 'warn');
        await App._refetchState();
      }
    },

    async confirmDate(date) {
      const [y, m] = [+date.slice(0, 4), +date.slice(5, 7)];
      const a = App.ensureAssignment(App.currentCityId, y, m);
      // ハード制約チェック
      const monthData = App.getCurrentMonthData();
      const ranked = Scheduler.rankCandidates(monthData, App.currentCityId, App.state.companies, App.state.assignments, App.rules.soft);
      const rank = ranked.find(r => r.date === date);
      if (rank && rank.hardViolations && rank.hardViolations.length) {
        if (!confirm(`⚠️ ハード制約違反があります：\n${rank.hardViolations.join('\n')}\n本当に確定しますか？`)) return;
      }
      // 1) ローカル楽観更新
      a.selectedDate = date;
      a.confirmed = true;
      App.state.lastUpdated = new Date().toISOString();
      App.state.version = (App.state.version || 0) + 1;
      App.saveLocal();
      App.toast(`${App.cities.find(c=>c.id===App.currentCityId)?.name} を ${date} で確定しました`, 'success');
      App.renderAll();
      // 2) サーバーへ差分送信
      if (!root.Api.hasBackend()) return;
      try {
        const res = await root.Api.confirmAssignment(App.currentCityId, y, m, date, null);
        const r = App._applyServerResponse(res);
        if (r === 'applied') App.renderAll();
        else if (r === 'rejected') await App._refetchState();
      } catch (e) {
        App.toast('確定の保存エラー（同期を取り直し）: ' + e.message, 'warn');
        await App._refetchState();
      }
    },

    async unconfirmDate() {
      if (!App.isAdminActive()) { App.toast('解除には管理者ログインが必要です', 'warn'); return; }
      const [y, m] = App.currentMonthKey.split('-').map(Number);
      const a = App.getAssignment(App.currentCityId, y, m);
      if (!a) return;
      if (!confirm('確定を解除して仮置きに戻しますか？')) return;
      // サーバー成功を確認してからローカル更新する（旧コードは先にローカルを変えて、
      // その後サーバー失敗してもエラーが画面に出ない→リロードで戻ってしまう事象があった）
      if (root.Api.hasBackend()) {
        const pw = root.Storage.getAdminPw ? root.Storage.getAdminPw() : null;
        if (!pw) { App.toast('管理者パスワードが見つかりません。再ログインしてください', 'error'); return; }
        try {
          const res = await root.Api.unconfirmAssignment(App.currentCityId, y, m, pw);
          if (!res || res.ok === false) {
            App.toast('解除に失敗しました：' + ((res && res.error) || 'サーバーエラー'), 'error');
            return;
          }
          App._applyServerResponse(res);
        } catch (e) {
          App.toast('サーバーに解除できませんでした: ' + e.message, 'error');
          return;
        }
      } else {
        // オフライン動作：ローカルのみ更新
        a.confirmed = false;
        a.selectedDate = null;
        App.state.lastUpdated = new Date().toISOString();
        App.state.version = (App.state.version || 0) + 1;
        App.saveLocal();
      }
      App.toast('確定を解除して仮置きに戻しました', 'success');
      App.renderAll();
    },

    async addCompany(company, deferPersist) {
      // 1) ローカル楽観更新
      App.state.companies.push(company);
      App.state.lastUpdated = new Date().toISOString();
      App.state.version = (App.state.version || 0) + 1;
      if (deferPersist) return;
      root.Storage.setMe(company.id, company.name);
      App.saveLocal();
      App.toast(`「${company.name}」を追加しました`, 'success');
      App.renderAll();
      // 2) サーバーへ差分送信（全上書きしない）
      if (!root.Api.hasBackend()) return;
      try {
        const res = await root.Api.addCompany(company);
        const r = App._applyServerResponse(res);
        if (r === 'applied') App.renderAll();
        else if (r === 'rejected') await App._refetchState();
      } catch (e) {
        App.toast('会社追加の保存エラー（同期を取り直し）: ' + e.message, 'warn');
        await App._refetchState();
      }
    },

    async removeCompany(companyId) {
      if (!App.isAdminActive()) { App.toast('削除には管理者ログインが必要です', 'warn'); return; }
      // 管理者パスワードが欠落/失効していたら、ローカル変更する前に弾く
      const pw = root.Storage.getAdminPw ? root.Storage.getAdminPw() : null;
      if (root.Api.hasBackend() && !pw) {
        App.toast('管理者パスワードが見つかりません。再ログインしてください', 'error');
        return;
      }
      // サーバー成功を先に確認してからローカル更新する（admin auth 失敗時の乖離防止）
      if (root.Api.hasBackend()) {
        try {
          const res = await root.Api.removeCompany(companyId, pw);
          if (!res || res.ok === false) {
            App.toast('削除に失敗しました：' + ((res && res.error) || 'サーバーエラー'), 'error');
            return;
          }
          App._applyServerResponse(res);
        } catch (e) {
          App.toast('削除の保存エラー（同期を取り直し）: ' + e.message, 'warn');
          await App._refetchState();
          return;
        }
      } else {
        // オフライン動作：ローカルのみ更新
        App.state.companies = App.state.companies.filter(c => c.id !== companyId);
        App.state.assignments.forEach(a => {
          a.statuses = (a.statuses || []).filter(s => s.companyId !== companyId);
        });
        App.state.lastUpdated = new Date().toISOString();
        App.state.version = (App.state.version || 0) + 1;
        App.saveLocal();
      }
      App.toast('削除しました', 'success');
      App.renderAll();
    },

    // ------- ポーリング -------
    startPolling() {
      if (App.pollTimer) return;
      App.pollTimer = setInterval(async () => {
        try {
          const res = await root.Api.pollState(App.state.lastUpdated, App.state.version);
          App._setSyncIndicator(true, '接続中');
          // changed=false の軽量レスポンスは state を含まない
          if (res && res.changed && res.state && (res.state.version || 0) > (App.state.version || 0)) {
            App.state = res.state;
            App.saveLocal();
            App.renderAll();
            App.toast('他のユーザーが更新しました', 'success');
          }
        } catch (e) {
          App._setSyncIndicator(false, 'オフライン');
        }
      }, POLL_INTERVAL_MS);
    },

    // 管理者セッションの有効性チェック（30分で自動失効）
    isAdminActive() {
      if (!root.Storage.isAdmin()) return false;
      const setAt = +sessionStorage.getItem('powerup-kenshu:adminSetAt') || 0;
      if (!setAt) return false;
      if (Date.now() - setAt > ADMIN_SESSION_MS) {
        root.Storage.setAdmin(false);
        sessionStorage.removeItem('powerup-kenshu:adminSetAt');
        App.toast('管理者セッションが切れました', 'warn');
        return false;
      }
      return true;
    },

    // ------- イベントバインド -------
    bindEvents() {
      // 月ナビ
      document.getElementById('btn-prev-month').addEventListener('click', () => App.moveMonth(-1));
      document.getElementById('btn-next-month').addEventListener('click', () => App.moveMonth(1));

      // 会社追加
      document.getElementById('btn-add-company').addEventListener('click', () => {
        const existingIds = new Set(App.state.companies.map(c => 'preset:' + c.name));
        UICompanyEntry.openAddModal({
          cities: App.cities,
          presets: App.presetCompanies,
          existingIds,
          onSave: async (companies) => {
            // 複数社同時追加：ローカルに先に反映して即UIを更新、
            // サーバーへは差分エンドポイントで1社ずつ送る（全上書きしない）
            for (const c of companies) App.addCompany(c, true);
            if (companies.length === 1) {
              root.Storage.setMe(companies[0].id, companies[0].name);
            }
            App.saveLocal();
            App.toast(`${companies.length}社 を追加しました`, 'success');
            App.renderAll();
            if (!root.Api.hasBackend()) return;
            try {
              // Promise.allSettled で1社失敗しても他は通すようにする
              const results = await Promise.allSettled(companies.map(c => root.Api.addCompany(c)));
              const rejected = results.some(r => r.status === 'rejected' || (r.value && r.value.ok === false));
              if (rejected) {
                App.toast('一部の会社追加がサーバー側で失敗しました。最新状態を取り直します', 'warn');
                await App._refetchState();
                return;
              }
              // 最後のレスポンスが最新版なので、それで反映を試みる
              const last = results[results.length - 1].value;
              const r = App._applyServerResponse(last);
              if (r === 'applied') App.renderAll();
              else if (r === 'rejected') await App._refetchState();
            } catch (e) {
              App.toast('会社追加の保存エラー（同期を取り直し）: ' + e.message, 'warn');
              await App._refetchState();
            }
          },
        });
      });

      // LINE
      document.getElementById('btn-export-line').addEventListener('click', async () => {
        const btn = document.getElementById('btn-export-line');
        btn.classList.add('is-loading');
        try {
          const text = ExportLine.generate(App.state, App.cities);
          const ok = await ExportLine.copyToClipboard(text);
          App.toast(ok ? 'LINE用テキストをコピーしました' : 'コピーに失敗しました', ok ? 'success' : 'error');
        } finally {
          btn.classList.remove('is-loading');
        }
      });

      // PDF
      document.getElementById('btn-export-pdf').addEventListener('click', async () => {
        const btn = document.getElementById('btn-export-pdf');
        btn.classList.add('is-loading');
        App.showOverlay('PDFを生成中...');
        try {
          await ExportPDF.exportYearSchedule(App.state, App.cities);
          App.toast('PDFを保存しました', 'success');
        } catch (e) {
          console.error(e);
          App.toast('PDF出力に失敗: ' + e.message, 'error');
        } finally {
          btn.classList.remove('is-loading');
          App.hideOverlay();
        }
      });

      // 使い方マニュアル
      const helpBtn = document.getElementById('btn-help');
      if (helpBtn) {
        helpBtn.addEventListener('click', () => App.openModal('modal-help'));
      }

      // 管理者
      document.getElementById('btn-admin').addEventListener('click', () => {
        if (root.Storage.isAdmin()) {
          if (confirm('管理者ログアウトしますか？')) {
            root.Storage.setAdmin(false);
            App.renderAll();
            App.toast('管理者ログアウト', 'success');
          }
        } else {
          App.openModal('modal-admin');
          setTimeout(() => document.getElementById('input-admin-pw').focus(), 50);
        }
      });
      document.getElementById('btn-admin-login').addEventListener('click', () => {
        const pw = document.getElementById('input-admin-pw').value;
        if (pw && pw.length >= 1) {
          // パスワードはサーバー検証するため sessionStorage に保持
          root.Storage.setAdmin(true, pw);
          sessionStorage.setItem('powerup-kenshu:adminSetAt', String(Date.now()));
          App.closeModal('modal-admin');
          document.getElementById('input-admin-pw').value = '';
          App.toast('管理者モードON（30分で自動失効）', 'success');
          App.renderAll();
        } else {
          App.toast('パスワードを入力してください', 'warn');
        }
      });

      // 全モーダル：×ボタン・キャンセルボタンで閉じる
      document.querySelectorAll('.modal').forEach(m => {
        m.querySelectorAll('[data-modal-close]').forEach(b => {
          b.addEventListener('click', () => App.closeModal(m.id));
        });
        // 背景クリックで閉じる
        m.addEventListener('click', (e) => {
          if (e.target === m) App.closeModal(m.id);
        });
      });
      // ESCで開いているモーダルを閉じる
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          document.querySelectorAll('.modal:not(.hidden)').forEach(m => App.closeModal(m.id));
        }
      });
    },

    openModal(id) { document.getElementById(id).classList.remove('hidden'); },
    closeModal(id) { document.getElementById(id).classList.add('hidden'); },
    showOverlay(msg) {
      if (document.getElementById('fs-overlay')) return;
      const el = document.createElement('div');
      el.id = 'fs-overlay';
      el.className = 'fs-overlay';
      el.innerHTML = `<div class="spinner"></div><div>${msg || '処理中...'}</div>`;
      document.body.appendChild(el);
    },
    hideOverlay() {
      const el = document.getElementById('fs-overlay');
      if (el) el.remove();
    },

    moveMonth(delta) {
      const keys = Object.keys(App.ozawaRange.ranges).sort();
      let idx = keys.indexOf(App.currentMonthKey);
      if (idx < 0) idx = 0;
      let next = idx + delta;
      while (next >= 0 && next < keys.length && App.ozawaRange.skipMonths.includes(keys[next])) next += delta;
      if (next < 0 || next >= keys.length) return;
      App.currentMonthKey = keys[next];
      App.selectedDate = null;
      App.renderAll();
    },

    // ------- トースト -------
    toast(msg, kind) {
      const root = document.getElementById('toast-root');
      const el = document.createElement('div');
      el.className = 'toast ' + (kind || '');
      el.textContent = msg;
      root.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
      setTimeout(() => el.remove(), 3000);
    },
  };

  document.addEventListener('DOMContentLoaded', () => App.init());
  root.App = App;
})(window);
