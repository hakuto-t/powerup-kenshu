/* ui-company-entry.js — 調整さん風 会社セルフエントリ（プリセット + 手動） */
(function (root) {
  'use strict';

  const UICompanyEntry = {
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
      const { companies, cities, assignments, isAdmin, currentMonth } = ctx;
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

      const html = `
        <table>
          <thead>
            <tr>
              <th class="col-company">会社</th>
              <th>都市</th>
              ${days.map(d => {
                const wd = '日月火水木金土'[new Date(d.date + 'T00:00:00+09:00').getDay()];
                return `<th><small>${+d.date.slice(5,7)}/${+d.date.slice(8,10)}<br>(${wd})</small></th>`;
              }).join('')}
              ${isAdmin ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${companies.map(c => {
              const cityIds = c.cityParticipation && c.cityParticipation.length ? c.cityParticipation : cities.map(x => x.id);
              return cityIds.map(cid => {
                const cityObj = cities.find(x => x.id === cid);
                const cityName = cityObj?.name || cid;
                return `<tr data-company-id="${c.id}" data-city="${cid}">
                  <td class="col-company">${escapeHtml(c.name)}</td>
                  <td><span style="color:${cityObj?.color || '#888'};font-weight:700">${cityName}</span></td>
                  ${days.map(d => {
                    const s = Scheduler.getStatusFor(c.id, cid, d.date, assignments);
                    return `<td class="status-picker-cell">${renderStatusPicker(s, { companyId: c.id, cityId: cid, date: d.date })}</td>`;
                  }).join('')}
                  ${isAdmin ? `<td class="row-controls"><button data-action="remove-company" data-company="${c.id}" title="削除">✕</button></td>` : ''}
                </tr>`;
              }).join('');
            }).join('')}
          </tbody>
        </table>`;
      container.innerHTML = html;

      container.querySelectorAll('.status-picker-cell .sp-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const current = btn.dataset.current;
          const target = btn.dataset.target;
          // 同じステータスを再クリックなら UNKNOWN に戻す、違う状態なら target に変更
          const next = current === target ? 'UNKNOWN' : target;
          ctx.onStatusToggle && ctx.onStatusToggle(btn.dataset.company, btn.dataset.city, btn.dataset.date, next);
        });
      });
      container.querySelectorAll('[data-action="remove-company"]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (confirm('この会社を削除しますか？')) {
            ctx.onRemove && ctx.onRemove(btn.dataset.company);
          }
        });
      });
    },
  };

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
