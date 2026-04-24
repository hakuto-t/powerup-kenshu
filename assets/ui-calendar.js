/* ui-calendar.js — 月間カレンダー描画 */
(function (root) {
  'use strict';

  const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

  const UICalendar = {
    render(container, monthData, ctx) {
      // ctx: { cityId, assignments, ranked, selectedDate, otherConfirmedByDate, city }
      container.innerHTML = '';
      if (!monthData) {
        container.innerHTML = '<div class="sp-empty">この月は研修なし（2月は小澤さん休講月）</div>';
        return;
      }

      // 曜日ヘッダー
      DOW_LABELS.forEach((dow, i) => {
        const el = document.createElement('div');
        el.className = 'cal-dow';
        if (i === 0) el.classList.add('dow-sun');
        if (i === 6) el.classList.add('dow-sat');
        el.textContent = dow;
        container.appendChild(el);
      });

      // 月のレイアウト（当月1日の曜日からオフセット）
      const firstDay = new Date(monthData.year, monthData.month - 1, 1);
      const lastDay = new Date(monthData.year, monthData.month, 0);
      const leadingEmpty = firstDay.getDay();

      // 先頭の空セル
      for (let i = 0; i < leadingEmpty; i++) {
        const el = document.createElement('div');
        el.className = 'cal-cell empty';
        container.appendChild(el);
      }

      // 当月日
      const dayMap = new Map((monthData.days || []).map(d => [d.date, d]));
      const rankedMap = new Map((ctx.ranked || []).map(r => [r.date, r]));
      const suggestDates = new Set((ctx.suggestions || []).map(s => s.date));

      for (let d = 1; d <= lastDay.getDate(); d++) {
        const iso = `${monthData.year}-${String(monthData.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayInfo = dayMap.get(iso) || { date: iso, inCandidateRange: false, otherPrograms: [] };
        const rank = rankedMap.get(iso);
        const dow = new Date(iso + 'T00:00:00+09:00').getDay();

        const el = document.createElement('div');
        el.className = 'cal-cell';
        el.dataset.date = iso;
        if (dayInfo.inCandidateRange) el.classList.add('in-range');
        else el.classList.add('out-range');

        // 確定済みか？
        const ownAssign = ctx.ownAssignment;
        const isSelected = ownAssign && ownAssign.selectedDate === iso;
        const isConfirmed = ownAssign && ownAssign.confirmed && ownAssign.selectedDate === iso;
        if (isConfirmed) el.classList.add('confirmed');
        else if (isSelected) el.classList.add('selected');

        // 他都市確定バッジ
        const otherCityConfirm = ctx.otherConfirmedByDate && ctx.otherConfirmedByDate[iso];

        // ハード制約違反か？
        const hasViolation = rank && rank.hardViolations && rank.hardViolations.length > 0;

        const dowClass = dow === 0 ? 'wd-sun' : dow === 6 ? 'wd-sat' : '';
        el.innerHTML = `
          <div class="cell-date">
            <span class="${dowClass}">${d}</span>
            ${suggestDates.has(iso) ? '<span class="badge-star">★</span>' : ''}
          </div>
          ${dayInfo.holiday ? `<div class="cell-holiday">${dayInfo.holiday}</div>` : ''}
          ${renderSummary(rank)}
          ${renderBadges(dayInfo, otherCityConfirm, isConfirmed, hasViolation, rank, ctx.city)}
        `;

        if (dayInfo.inCandidateRange) {
          el.addEventListener('click', () => ctx.onCellClick && ctx.onCellClick(iso));
        }
        container.appendChild(el);
      }
    },
  };

  function renderSummary(rank) {
    if (!rank || !rank.participation) return '';
    const p = rank.participation;
    if (p.total === 0) return '';
    return `<div class="cell-summary">
      <span class="cs-ok">○${p.ok}</span>
      ${p.maybe ? `<span class="cs-maybe">△${p.maybe}</span>` : ''}
      ${p.ng ? `<span class="cs-ng">×${p.ng}</span>` : ''}
    </div>`;
  }

  function renderBadges(dayInfo, otherCityConfirm, isConfirmed, hasViolation, rank, city) {
    const parts = [];
    if (isConfirmed) {
      parts.push(`<span class="badge-confirm">🔒 確定</span>`);
    }
    if (otherCityConfirm) {
      parts.push(`<span class="badge-other-city">🔒${otherCityConfirm.cityName}</span>`);
    }
    if (hasViolation) {
      parts.push(`<span class="badge-warn">⚠️${rank.hardViolations[0].replace(/\(.*\)/, '')}</span>`);
    }
    // 小澤希望達成
    if (rank && rank.softHits && rank.softHits.length > 0) {
      const top = rank.softHits.find(h => h.id === 'S4' || h.id === 'S5') || rank.softHits[0];
      parts.push(`<span class="badge-ozawa">${top.label.charAt(0)}</span>`);
    }
    // 他研修（最大2件）— 共存不可は赤系、共存可は黄系
    const op = (dayInfo.otherPrograms || []).slice(0, 2);
    for (const p of op) {
      const compat = root.Scheduler && root.Scheduler.isOtherProgramCompatible(city, p.name);
      const cls = compat ? 'badge-ot badge-ot-ok' : 'badge-ot badge-ot-ng';
      const title = compat ? `${p.name}（共存可）` : `${p.name}（共存不可・衝突）`;
      parts.push(`<span class="${cls}" title="${escapeHtml(title)}">${escapeHtml(p.name)}</span>`);
    }
    if ((dayInfo.otherPrograms || []).length > 2) {
      parts.push(`<span class="badge-ot">+${dayInfo.otherPrograms.length - 2}</span>`);
    }
    if (!parts.length) return '';
    return `<div class="cell-badges">${parts.join('')}</div>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  root.UICalendar = UICalendar;
})(window);
