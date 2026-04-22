/* export-line.js — LINE貼付用テキスト生成 */
(function (root) {
  'use strict';

  const ExportLine = {
    // 確定分のみ抽出し、LINEに貼りやすい装飾なしテキスト（文の途中で改行しない）
    generate(state, cities) {
      const cityMap = Object.fromEntries(cities.map(c => [c.id, c]));
      const lines = [];
      lines.push(`【エスト パワーアップ研修 2026年度 確定スケジュール】`);
      lines.push('');

      const byMonth = {};
      for (const a of state.assignments) {
        if (!a.confirmed || !a.selectedDate) continue;
        const key = `${a.year}-${String(a.month).padStart(2, '0')}`;
        if (!byMonth[key]) byMonth[key] = [];
        byMonth[key].push(a);
      }
      const sortedKeys = Object.keys(byMonth).sort();
      if (!sortedKeys.length) {
        lines.push('（まだ確定した日程はありません）');
      } else {
        for (const key of sortedKeys) {
          const [y, m] = key.split('-');
          lines.push(`■${y}年${+m}月`);
          byMonth[key].sort((a, b) => a.selectedDate.localeCompare(b.selectedDate));
          for (const a of byMonth[key]) {
            const c = cityMap[a.cityId];
            const fmt = formatDate(a.selectedDate);
            lines.push(`・${c ? c.fullName : a.cityId}：${fmt}`);
          }
          lines.push('');
        }
      }
      // 確定数 = 全 assignment で confirmed true のもの
      const confirmedCount = (state.assignments || []).filter(a => a.confirmed).length;
      // 総枠 = 5都市 × 実施11ヶ月 = 55
      const totalSlots = (cities?.length || 5) * 11;
      const pending = totalSlots - confirmedCount;
      if (pending > 0) {
        lines.push(`※未確定：${pending}件 / 全${totalSlots}件`);
      }
      return lines.join('\n');
    },

    async copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        // フォールバック
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); return true; }
        catch (e2) { return false; }
        finally { document.body.removeChild(ta); }
      }
    },
  };

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00+09:00');
    const wd = '日月火水木金土'[d.getDay()];
    return `${d.getMonth() + 1}月${d.getDate()}日(${wd})`;
  }

  root.ExportLine = ExportLine;
})(window);
