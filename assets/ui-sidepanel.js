/* ui-sidepanel.js — 選択日のサイドパネル */
(function (root) {
  'use strict';

  const UISidePanel = {
    renderEmpty(el) {
      el.innerHTML = '<div class="sp-empty"><p>候補日セルをクリックすると、参加状況・譲歩提案・小澤希望達成度が表示されます。</p></div>';
    },

    // Phase 4: 未選択時の常時サマリー。月内の候補日トップ5をランキング表示。
    // ctx: { cityName, ranked, suggestions, otherConfirmedByDate, monthData, onCellClick, currentMonthLabel }
    renderSummary(el, ctx) {
      const { cityName, ranked, suggestions, otherConfirmedByDate, monthData, currentMonthLabel, city } = ctx;
      if (!ranked || !ranked.length) {
        el.innerHTML = `<div class="sp-empty">
          <p><strong>${escapeHtml(cityName || '')}</strong> ${escapeHtml(currentMonthLabel || '')}の候補日はありません。</p>
          <p style="color:var(--tx3);font-size:0.85rem;margin-top:8px">月を切り替えるか、候補日セルをクリックして詳細を確認してください。</p>
        </div>`;
        return;
      }
      const top = ranked.slice(0, 5);
      const parts = [];
      parts.push(`<div class="sp-summary-head">
        <div class="sp-summary-title">📅 ${escapeHtml(cityName || '')} ${escapeHtml(currentMonthLabel || '')} の候補日ランキング</div>
        <div class="sp-summary-sub">クリックで詳細表示。○×▽入力後の最有力日が上から並びます。</div>
      </div>`);
      parts.push(`<div class="sp-summary-list">`);
      top.forEach((r, i) => {
        const rank = i + 1;
        const wd = '日月火水木金土'[new Date(r.date + 'T00:00:00+09:00').getDay()];
        const hasViolation = r.hardViolations && r.hardViolations.length > 0;
        // 共存不可の他研修件数（共存可は警告しない）
        const incompat = r.incompatibleOtherPrograms || [];
        const other = incompat.length;
        const ozawaHits = (r.softHits || []).length;
        const conf = otherConfirmedByDate && otherConfirmedByDate[r.date];
        const p = r.participation;
        const classes = ['sp-summary-row'];
        classes.push('rank-' + rank);
        if (hasViolation) classes.push('has-violation');
        if (conf) classes.push('other-confirmed');
        parts.push(`<div class="${classes.join(' ')}" data-date="${r.date}">
          <div class="sp-summary-rank">${rank}位</div>
          <div class="sp-summary-main">
            <div class="sp-summary-date">${+r.date.slice(5,7)}/${+r.date.slice(8,10)}(${wd})
              ${hasViolation ? '<span class="sp-summary-tag violation">⚠ハード違反</span>' : ''}
              ${other ? '<span class="sp-summary-tag other">他研修' + other + '</span>' : ''}
              ${ozawaHits ? '<span class="sp-summary-tag ozawa">小澤+' + ozawaHits + '</span>' : ''}
              ${conf ? '<span class="sp-summary-tag conf">🔒他都市確定</span>' : ''}
            </div>
            ${p ? `<div class="sp-summary-count">
              <span class="ok">○${p.ok}</span>
              <span class="maybe">△${p.maybe}</span>
              <span class="ng">×${p.ng}</span>
              <span class="unk">?${p.unknown}</span>
            </div>` : ''}
          </div>
          <div class="sp-summary-score">${formatScore(r.totalScore)}</div>
        </div>`);
      });
      parts.push(`</div>`);
      // 最小譲歩レコメンド
      if (suggestions && suggestions.length) {
        parts.push(`<div class="sp-section"><h4>★ 最小譲歩レコメンド</h4>`);
        for (const s of suggestions) {
          parts.push(`<div class="sp-callout"><strong>${escapeHtml(s.message)}</strong></div>`);
        }
        parts.push(`</div>`);
      }
      el.innerHTML = parts.join('');
      el.querySelectorAll('.sp-summary-row').forEach(row => {
        row.addEventListener('click', () => ctx.onCellClick && ctx.onCellClick(row.dataset.date));
      });
    },

    render(el, ctx) {
      // ctx: { date, rank, monthData, cityId, cityName, companies, assignments, suggestions, onStatusChange, onConfirm, onUnconfirm, isConfirmed, isAdmin }
      const { date, rank, cityName, companies, assignments, suggestions, isConfirmed, isAdmin, otherCityInfo } = ctx;
      const p = rank?.participation;

      const parts = [];
      parts.push(`<div class="sp-detail-head">
        <button type="button" class="sp-back-btn" data-action="back" title="候補日ランキングに戻る">← 一覧に戻る</button>
        <div class="sp-date">${cityName}｜${SchedUtil.fmt(date)}</div>
      </div>`);
      parts.push(`<div class="sp-score">小澤スコア <span class="sp-score-num">${rank ? formatScore(rank.totalScore) : '-'}</span></div>`);

      // ハード違反
      if (rank && rank.hardViolations && rank.hardViolations.length) {
        parts.push(`<div class="sp-callout" style="background:rgba(220,38,38,.06);border-color:var(--r)">
          <strong>⚠️ ハード制約違反</strong><br>${rank.hardViolations.join('<br>')}
        </div>`);
      }

      // 他都市確定済み
      if (otherCityInfo) {
        parts.push(`<div class="sp-callout" style="background:rgba(124,58,237,.06);border-color:var(--p)">
          <strong>🔒 ${otherCityInfo.cityName}で既に確定済み</strong>
        </div>`);
      }

      // 参加状況（3ボタン並列で直接選択）
      const relevant = companies.filter(c => !c.cityParticipation || c.cityParticipation.length === 0 || c.cityParticipation.includes(ctx.cityId));
      const countBox = p ? `
        <div class="sp-count-grid">
          <div class="sp-count ok"><span class="n">${p.ok}</span><span class="l">○参加可</span></div>
          <div class="sp-count maybe"><span class="n">${p.maybe}</span><span class="l">△調整可</span></div>
          <div class="sp-count ng"><span class="n">${p.ng}</span><span class="l">×不可</span></div>
          <div class="sp-count unknown"><span class="n">${p.unknown}</span><span class="l">未入力</span></div>
        </div>` : '';
      parts.push(`<div class="sp-section"><h4>参加状況</h4>
        ${countBox}
        <div class="sp-companies">
          ${relevant.map(c => {
            const s = Scheduler.getStatusFor(c.id, ctx.cityId, date, assignments);
            return `<div class="sp-company" data-company-id="${c.id}">
              ${root.renderStatusPicker(s, { companyId: c.id, cityId: ctx.cityId, date: date })}
              <span>${escapeHtml(c.name)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`);

      // 最小譲歩
      if (suggestions && suggestions.length) {
        parts.push(`<div class="sp-section"><h4>★ 最小譲歩レコメンド</h4>`);
        for (const s of suggestions) {
          parts.push(`<div class="sp-callout"><strong>${escapeHtml(s.message)}</strong></div>`);
        }
        parts.push(`</div>`);
      }

      // 小澤希望達成
      if (rank && rank.softHits && rank.softHits.length) {
        parts.push(`<div class="sp-section"><h4>小澤希望達成</h4><div class="sp-ozawa-hits">
          ${rank.softHits.map(h => `<div class="hit ${h.id.toLowerCase()}">${escapeHtml(h.label)} <span style="margin-left:auto">+${h.bonus}</span></div>`).join('')}
        </div></div>`);
      }

      // 他研修（共存可 / 共存不可 を分けて表示）
      const dayInfo = ctx.monthData?.days?.find(d => d.date === date);
      if (dayInfo && dayInfo.otherPrograms && dayInfo.otherPrograms.length) {
        const split = (root.Scheduler && ctx.city)
          ? root.Scheduler.splitOtherPrograms(ctx.city, dayInfo.otherPrograms)
          : { compat: [], incompat: dayInfo.otherPrograms };
        const parts2 = [];
        if (split.incompat.length) {
          parts2.push(`<div style="margin-bottom:6px"><strong style="color:var(--r);font-size:.82rem">⚠️ 共存不可（衝突）</strong><br>${split.incompat.map(p => `<span class="badge-ot badge-ot-ng" style="margin-right:4px">${escapeHtml(p.name)}</span>`).join('')}</div>`);
        }
        if (split.compat.length) {
          parts2.push(`<div><strong style="color:var(--tx3);font-size:.82rem">✓ 共存可</strong><br>${split.compat.map(p => `<span class="badge-ot badge-ot-ok" style="margin-right:4px">${escapeHtml(p.name)}</span>`).join('')}</div>`);
        }
        parts.push(`<div class="sp-section"><h4>他研修</h4>${parts2.join('')}</div>`);
      }

      // アクション
      if (!otherCityInfo) {
        parts.push(`<div class="sp-actions">
          ${isConfirmed
            ? `<button class="btn" data-action="unconfirm" ${isAdmin ? '' : 'disabled title="管理者のみ解除可能"'}>仮置きに戻す</button>`
            : `<button class="btn btn-primary" data-action="confirm">この日で確定する 🔒</button>`
          }
        </div>`);
      }

      el.innerHTML = parts.join('');

      // イベント（3ボタン並列ピッカー）
      el.querySelectorAll('.status-picker .sp-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const companyEl = btn.closest('.sp-company');
          const companyId = companyEl.dataset.companyId;
          const current = btn.dataset.current;
          const target = btn.dataset.target;
          const next = current === target ? 'UNKNOWN' : target;
          ctx.onStatusChange && ctx.onStatusChange(companyId, date, next);
        });
      });
      el.querySelectorAll('[data-action="confirm"]').forEach(b => b.addEventListener('click', () => ctx.onConfirm && ctx.onConfirm(date)));
      el.querySelectorAll('[data-action="unconfirm"]').forEach(b => b.addEventListener('click', () => ctx.onUnconfirm && ctx.onUnconfirm()));
      el.querySelectorAll('[data-action="back"]').forEach(b => b.addEventListener('click', () => ctx.onBack && ctx.onBack()));
    },
  };

  function statusClass(s) {
    return s === 'OK' ? 'st-ok' : s === 'MAYBE' ? 'st-maybe' : s === 'NG' ? 'st-ng' : 'st-unknown';
  }
  function statusLabel(s) {
    return s === 'OK' ? '○' : s === 'MAYBE' ? '△' : s === 'NG' ? '×' : '・';
  }
  function nextStatus(s) {
    // UNKNOWN → OK → MAYBE → NG → UNKNOWN
    return s === 'UNKNOWN' ? 'OK' : s === 'OK' ? 'MAYBE' : s === 'MAYBE' ? 'NG' : 'UNKNOWN';
  }
  function formatScore(n) {
    if (n === -Infinity) return '—（ハード違反）';
    return (n >= 0 ? '+' : '') + (Math.round(n * 10) / 10) + '点';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  root.UISidePanel = UISidePanel;
})(window);
