/* ui-company-entry.js — 調整さん風 会社セルフエントリ（プリセット + 手動） */
(function (root) {
  'use strict';

  // 都市別アコーディオンの開閉状態（モジュール内で保持、都市タブ切替時にリセット）
  let _expandedSet = null;

  const UICompanyEntry = {
    // 外部から呼ばれる：都市タブを切り替えたときにその都市だけ展開状態にする
    setCurrentCityForCollapse(cityId) {
      _expandedSet = new Set([cityId]);
    },
    openAddModal(ctx) {
      // ctx: { cities, presets, existingIds, onSave }
      const modal = document.getElementById('modal-add-company');
      const nameEl = document.getElementById('input-company-name');
      const citiesEl = document.getElementById('input-company-cities');
      const presetSection = document.getElementById('preset-section');
      const presetList = document.getElementById('preset-list');

      nameEl.value = '';
      citiesEl.innerHTML = ctx.cities.map(c => `
        <label><input type="checkbox" value="${c.id}" checked /> <span style="color:${c.color}">●</span> ${c.name}</label>
      `).join('');

      // プリセット表示
      const availablePresets = (ctx.presets || []).filter(p => !ctx.existingIds.has(presetId(p)));
      if (availablePresets.length > 0) {
        presetSection.classList.remove('hidden');
        presetList.innerHTML = availablePresets.map(p => `
          <label>
            <input type="checkbox" value="${escapeAttr(presetId(p))}" data-name="${escapeAttr(p.name)}" data-cities="${escapeAttr(JSON.stringify(p.cityParticipation || ctx.cities.map(c=>c.id)))}" />
            <span>${escapeHtml(p.name)}</span>
          </label>
        `).join('');
      } else {
        presetSection.classList.add('hidden');
      }

      modal.classList.remove('hidden');
      setTimeout(() => nameEl.focus(), 50);

      // クリーンアップ用リスナ保管
      const state = { onSaveBound: null, onKeyDown: null, onBgClick: null };

      const close = () => {
        modal.classList.add('hidden');
        if (state.onSaveBound) document.getElementById('btn-company-save').removeEventListener('click', state.onSaveBound);
        if (state.onKeyDown) document.removeEventListener('keydown', state.onKeyDown);
        if (state.onBgClick) modal.removeEventListener('click', state.onBgClick);
        modal.querySelectorAll('[data-modal-close]').forEach(b => b.removeEventListener('click', close));
      };

      const onSave = () => {
        const selectedCities = Array.from(citiesEl.querySelectorAll('input:checked')).map(i => i.value);
        if (selectedCities.length === 0) { alert('参加する都市を1つ以上選んでください'); return; }

        const toAdd = [];
        // プリセット分
        presetList.querySelectorAll('input:checked').forEach(i => {
          const name = i.dataset.name;
          const cities = (() => { try { return JSON.parse(i.dataset.cities); } catch (e) { return selectedCities; } })();
          toAdd.push(makeCompany(name, cities));
        });
        // 手動入力分
        const manualName = nameEl.value.trim();
        if (manualName) {
          toAdd.push(makeCompany(manualName, selectedCities));
        }

        if (toAdd.length === 0) { alert('追加する会社を選ぶか、会社名を入力してください'); return; }

        ctx.onSave(toAdd);
        close();
      };

      // イベントバインド
      const saveBtn = document.getElementById('btn-company-save');
      state.onSaveBound = onSave;
      saveBtn.addEventListener('click', state.onSaveBound);

      modal.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));

      // 背景クリックで閉じる（.modal-card 内のクリックは除外）
      state.onBgClick = (e) => {
        if (e.target === modal) close();
      };
      modal.addEventListener('click', state.onBgClick);

      // ESCで閉じる
      state.onKeyDown = (e) => {
        if (e.key === 'Escape') close();
      };
      document.addEventListener('keydown', state.onKeyDown);
    },

    renderCompaniesTable(container, ctx) {
      const { companies, cities, assignments, isAdmin, currentMonth, currentCityId } = ctx;

      // 再描画の前に各都市グループの横スクロール位置を退避（描画後に復元する）
      const scrollMemo = new Map();
      container.querySelectorAll('details.city-group').forEach(d => {
        const body = d.querySelector('.city-group-body');
        if (body) scrollMemo.set(d.dataset.city, body.scrollLeft);
      });

      if (!companies.length) {
        container.innerHTML = '<div class="sp-empty">まだ会社が登録されていません。ヘッダーの「＋ 自分の会社を追加」で登録してください。</div>';
        return;
      }

      const month = currentMonth;
      if (!month) { container.innerHTML = '<div class="sp-empty">月を選択してください</div>'; return; }
      const days = (month.days || []).filter(d => d.inCandidateRange);
      if (!days.length) {
        container.innerHTML = '<div class="sp-empty">この月は候補日がありません</div>';
        return;
      }

      // 開閉状態を初期化：初回または currentCity が変わった直後はそれだけ開く
      if (!_expandedSet) _expandedSet = new Set([currentCityId]);

      // 都市別にメンバーをグルーピング（都市マスタの並び順＝表示順）
      const groups = cities.map(city => {
        const members = companies.filter(c => {
          const cids = (c.cityParticipation && c.cityParticipation.length) ? c.cityParticipation : cities.map(x => x.id);
          return cids.includes(city.id);
        });
        return { city, members };
      });

      const toolbar = `
        <div class="city-group-toolbar">
          <button type="button" class="btn-tiny" data-action="expand-all">＋ 全部ひらく</button>
          <button type="button" class="btn-tiny" data-action="collapse-all">− 全部とじる</button>
          <button type="button" class="btn-tiny btn-tiny-primary" data-action="focus-current">▼ いま選んでる都市だけ開く</button>
          <span class="toolbar-hint">他都市は閉じておくと見やすいよ</span>
        </div>`;

      const groupsHtml = groups.map(({ city, members }) => {
        const isOpen = _expandedSet.has(city.id);
        const isCurrent = city.id === currentCityId;
        const confirmedCount = assignments.filter(a => a.cityId === city.id && a.confirmed).length;
        const body = members.length
          ? renderCityTable(city, members, days, assignments, isAdmin)
          : '<div class="sp-empty">この都市には、まだ会社が登録されていません。</div>';
        return `
          <details class="city-group ${isCurrent ? 'is-current' : ''}" data-city="${city.id}" ${isOpen ? 'open' : ''}>
            <summary class="city-group-head" style="border-left-color:${city.color}">
              <span class="cg-chev">▶</span>
              <span class="cg-dot" style="background:${city.color}"></span>
              <span class="cg-name">${escapeHtml(city.name)}</span>
              <span class="cg-count">${members.length}社</span>
              <span class="cg-progress">${confirmedCount}/11 確定</span>
              ${isCurrent ? '<span class="cg-tag">いま対象</span>' : ''}
            </summary>
            <div class="city-group-body">
              ${body}
            </div>
          </details>`;
      }).join('');

      container.innerHTML = toolbar + '<div class="city-groups">' + groupsHtml + '</div>';

      // 退避しておいた横スクロール位置を復元（○×▽押下で左端に戻るのを防ぐ）
      container.querySelectorAll('details.city-group').forEach(d => {
        const prev = scrollMemo.get(d.dataset.city);
        if (prev == null) return;
        const body = d.querySelector('.city-group-body');
        if (body) body.scrollLeft = prev;
      });

      // 開閉トグル → 内部状態を同期
      container.querySelectorAll('details.city-group').forEach(d => {
        d.addEventListener('toggle', () => {
          if (d.open) _expandedSet.add(d.dataset.city);
          else _expandedSet.delete(d.dataset.city);
        });
      });

      // ツールバー
      container.querySelector('[data-action="expand-all"]').addEventListener('click', () => {
        container.querySelectorAll('details.city-group').forEach(d => { d.open = true; });
      });
      container.querySelector('[data-action="collapse-all"]').addEventListener('click', () => {
        container.querySelectorAll('details.city-group').forEach(d => { d.open = false; });
      });
      container.querySelector('[data-action="focus-current"]').addEventListener('click', () => {
        container.querySelectorAll('details.city-group').forEach(d => {
          d.open = (d.dataset.city === currentCityId);
        });
      });

      // ○△×
      container.querySelectorAll('.status-picker-cell .sp-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const current = btn.dataset.current;
          const target = btn.dataset.target;
          const next = current === target ? 'UNKNOWN' : target;
          ctx.onStatusToggle && ctx.onStatusToggle(btn.dataset.company, btn.dataset.city, btn.dataset.date, next);
        });
      });
      // 会社削除（管理者）— 誤タップ防止のため2段階クリック方式
      // 1回目: 警告状態へ遷移（赤く脈打ち、「もう一度押すと削除」と表示）
      // 2回目(3秒以内): 実削除を実行。タイムアウトで自動リセット。
      const ARM_DURATION_MS = 3000;
      const disarm = (btn) => {
        btn.classList.remove('armed');
        const label = btn.querySelector('.btn-remove-label');
        if (label) label.textContent = '削除';
        if (btn._armTimer) { clearTimeout(btn._armTimer); btn._armTimer = null; }
      };
      container.querySelectorAll('[data-action="remove-company"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btn.classList.contains('armed')) {
            disarm(btn);
            ctx.onRemove && ctx.onRemove(btn.dataset.company);
            return;
          }
          // 他の削除ボタンが armed 状態なら先にリセット（同時に複数 armed にしない）
          container.querySelectorAll('.btn-remove-company.armed').forEach(other => {
            if (other !== btn) disarm(other);
          });
          btn.classList.add('armed');
          const label = btn.querySelector('.btn-remove-label');
          if (label) label.textContent = 'もう一度押すと削除';
          btn._armTimer = setTimeout(() => disarm(btn), ARM_DURATION_MS);
        });
      });
    },
  };

  // 都市グループ内のテーブル（会社は cityParticipation にその都市を含むもののみ）
  function renderCityTable(city, members, days, assignments, isAdmin) {
    return `
      <table>
        <thead>
          <tr>
            <th class="col-company">会社</th>
            ${days.map(d => {
              const wd = '日月火水木金土'[new Date(d.date + 'T00:00:00+09:00').getDay()];
              return `<th><small>${+d.date.slice(5,7)}/${+d.date.slice(8,10)}<br>(${wd})</small></th>`;
            }).join('')}
            ${isAdmin ? '<th></th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${members.map(c => `
            <tr data-company-id="${c.id}" data-city="${city.id}">
              <td class="col-company">${escapeHtml(c.name)}</td>
              ${days.map(d => {
                const s = Scheduler.getStatusFor(c.id, city.id, d.date, assignments);
                return `<td class="status-picker-cell">${renderStatusPicker(s, { companyId: c.id, cityId: city.id, date: d.date })}</td>`;
              }).join('')}
              ${isAdmin ? `<td class="row-controls"><button class="btn-remove-company" data-action="remove-company" data-company="${c.id}" data-name="${escapeAttr(c.name)}" title="削除"><span class="btn-remove-icon">🗑</span><span class="btn-remove-label">削除</span></button></td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function makeCompany(name, cityIds) {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? 'co_' + crypto.randomUUID()
      : 'co_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    return {
      id,
      name,
      shortName: String(name).slice(0, 8),
      cityParticipation: cityIds,
      addedAt: new Date().toISOString(),
    };
  }

  function presetId(preset) { return 'preset:' + preset.name; }

  function statusClass(s) {
    return s === 'OK' ? 'st-ok' : s === 'MAYBE' ? 'st-maybe' : s === 'NG' ? 'st-ng' : 'st-unknown';
  }
  function statusLabel(s) {
    return s === 'OK' ? '○' : s === 'MAYBE' ? '△' : s === 'NG' ? '×' : '・';
  }

  // 3ボタン並列選択ピッカー
  function renderStatusPicker(current, ctx) {
    const mk = (tgt, lbl, cls) => {
      const active = current === tgt;
      return `<button class="sp-btn ${cls} ${active ? 'active' : ''}"
        data-current="${current}" data-target="${tgt}"
        data-company="${ctx.companyId}" data-city="${ctx.cityId}" data-date="${ctx.date}"
        title="${tgt === 'OK' ? '参加可' : tgt === 'MAYBE' ? '調整可' : '不可'}">${lbl}</button>`;
    };
    return `<div class="status-picker">${mk('OK','○','st-ok')}${mk('MAYBE','△','st-maybe')}${mk('NG','×','st-ng')}</div>`;
  }

  root.renderStatusPicker = renderStatusPicker;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  root.UICompanyEntry = UICompanyEntry;
})(window);
