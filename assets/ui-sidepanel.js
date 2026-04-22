/* ui-sidepanel.js — 選択日のサイドパネル */
(function (root) {
  'use strict';

  const UISidePanel = {
    renderEmpty(el) {
      el.innerHTML = '<div class="sp-empty"><p>候補日セルをクリックすると、参加状況・譲歩提案・小澤希望達成度が表示されます。</p></div>';
    },

    render(el, ctx) {
      // ctx: { date, rank, monthData, cityId, cityName, companies, assignments, suggestions, onStatusChange, onConfirm, onUnconfirm, isConfirmed, isAdmin }
      const { date, rank, cityName, companies, assignments, suggestions, isConfirmed, isAdmin, otherCityInfo } = ctx;
      const p = rank?.participation;

      const parts = [];
      parts.push(`<div class="sp-date">${cityName}｜${SchedUtil.fmt(date)}</div>`);
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

      // 他研修
      const dayInfo = ctx.monthData?.days?.find(d => d.date === date);
      if (dayInfo && dayInfo.otherPrograms && dayInfo.otherPrograms.length) {
        parts.push(`<div class="sp-section"><h4>他研修（参加企業の都合要確認）</h4>
          <div>${dayInfo.otherPrograms.map(p => `<span class="badge-ot" style="margin-right:4px">${escapeHtml(p.name)}</span>`).join('')}</div>
        </div>`);
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
