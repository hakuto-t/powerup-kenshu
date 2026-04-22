/* export-pdf.js — 年間スケジュールPDF出力
 *
 * jsPDF の text() は日本語非対応で文字化けする。
 * 対策：全要素をHTMLで組み立てて html2canvas で一括キャプチャ → 画像として jsPDF に貼付。
 * これなら Google Fonts (Noto Sans JP) を使った日本語表示がそのまま画像化される。
 */
(function (root) {
  'use strict';

  const ExportPDF = {
    async exportYearSchedule(state, cities, ozawaRange) {
      // 1) PDF描画用の一時DOMを生成（画面外に配置）
      const container = buildPdfDom(state, cities, ozawaRange);
      document.body.appendChild(container);

      try {
        // フォントロード完了を待つ（Google Fonts は非同期）
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }

        // 2) html2canvas でキャプチャ（高解像度）
        const canvas = await html2canvas(container, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          logging: false,
          windowWidth: 1400,
        });
        const imgData = canvas.toDataURL('image/png');

        // 3) jsPDF A4横 に画像貼付（テキストは一切使わない）
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const pdfW = pdf.internal.pageSize.getWidth();  // 297mm
        const pdfH = pdf.internal.pageSize.getHeight(); // 210mm

        const marginX = 8;
        const marginY = 8;
        const availW = pdfW - marginX * 2;
        const availH = pdfH - marginY * 2;
        const imgRatio = canvas.width / canvas.height;

        let imgW = availW, imgH = availW / imgRatio;
        if (imgH > availH) { imgH = availH; imgW = availH * imgRatio; }
        // 中央揃え
        const offsetX = marginX + (availW - imgW) / 2;
        const offsetY = marginY;

        pdf.addImage(imgData, 'PNG', offsetX, offsetY, imgW, imgH);

        const fname = `エスト_パワーアップ研修_2026年度スケジュール_${new Date().toISOString().slice(0, 10)}.pdf`;
        pdf.save(fname);
      } finally {
        container.remove();
      }
    },
  };

  // --------------------------------
  // PDF用のDOMを構築（画面外、固定幅）
  // --------------------------------
  function buildPdfDom(state, cities, ozawaRange) {
    const wrap = document.createElement('div');
    wrap.id = 'pdf-render-area';
    wrap.style.cssText = `
      position: absolute; left: -10000px; top: 0;
      width: 1400px; padding: 40px 50px; background: #fff;
      font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
      color: #111; box-sizing: border-box;
    `;

    const keys = Object.keys(ozawaRange.ranges).sort();
    const activeKeys = keys.filter(k => !ozawaRange.skipMonths.includes(k));
    const confirmedCount = (state.assignments || []).filter(a => a.confirmed).length;
    const totalSlots = cities.length * activeKeys.length;
    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

    // ヘッダー
    const header = `
      <div style="border-bottom: 3px solid #e8b931; padding-bottom: 18px; margin-bottom: 24px;">
        <h1 style="font-size: 28px; font-weight: 900; color: #0f4c5c; margin: 0;">
          エスト パワーアップ研修　2026年度 年間スケジュール
        </h1>
        <div style="display: flex; gap: 30px; margin-top: 10px; font-size: 14px; color: #4b5563;">
          <div>期間：2026年8月 〜 2027年7月（全11回、2月は小澤さん休講）</div>
          <div>講師：小澤さん</div>
          <div>出力日：${escapeHtml(today)}</div>
        </div>
        <div style="margin-top: 10px; font-size: 14px;">
          <strong style="color: #0f4c5c; font-size: 18px;">${confirmedCount}</strong>
          <span style="color: #4b5563;"> / ${totalSlots} 確定</span>
          <span style="margin-left: 20px; color: #4b5563;">（未定 ${totalSlots - confirmedCount}件）</span>
        </div>
      </div>
    `;

    // メインテーブル：縦軸=月 / 横軸=都市
    const theadCities = cities.map(c => `
      <th style="padding: 12px 8px; background: #f8f9fb; border-radius: 6px; text-align: center; font-size: 14px; font-weight: 700;">
        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${c.color}; margin-right: 6px; vertical-align: middle;"></span>
        ${escapeHtml(c.name)}
      </th>
    `).join('');

    const rowsHtml = keys.map(k => {
      const [y, m] = k.split('-').map(Number);
      const skip = ozawaRange.skipMonths.includes(k);
      if (skip) {
        return `<tr>
          <th style="padding: 12px; background: #fff4e6; color: #d97706; border-radius: 6px; text-align: right; font-weight: 700; font-size: 14px; font-style: italic;">${y}年${m}月</th>
          <td colspan="${cities.length}" style="padding: 14px; background: #fff4e6; color: #d97706; border: 1px dashed #d97706; border-radius: 6px; text-align: center; font-size: 13px; font-style: italic;">
            小澤さん休講月（研修なし）
          </td>
        </tr>`;
      }
      const cells = cities.map(c => {
        const a = (state.assignments || []).find(x => x.cityId === c.id && x.year === y && x.month === m);
        if (a && a.confirmed && a.selectedDate) {
          const d = new Date(a.selectedDate + 'T00:00:00+09:00');
          const wd = '日月火水木金土'[d.getDay()];
          return `<td style="padding: 14px 8px; background: rgba(15,76,92,0.08); border: 2px solid #0f4c5c; border-radius: 6px; text-align: center; font-weight: 700;">
            <div style="font-size: 18px; color: #0f4c5c; font-weight: 900; line-height: 1.2;">${d.getMonth() + 1}/${d.getDate()}</div>
            <div style="font-size: 12px; color: #4b5563; margin-top: 2px;">${wd}</div>
          </td>`;
        }
        return `<td style="padding: 14px 8px; border: 1px dashed #d1d5db; border-radius: 6px; text-align: center; color: #9ca3af; font-size: 18px;">—</td>`;
      }).join('');
      return `<tr>
        <th style="padding: 12px; background: #f8f9fb; border-radius: 6px; text-align: right; font-weight: 700; font-size: 14px;">${y}年${m}月</th>
        ${cells}
      </tr>`;
    }).join('');

    const table = `
      <table style="width: 100%; border-collapse: separate; border-spacing: 6px; font-size: 14px;">
        <thead>
          <tr>
            <th style="padding: 12px; background: transparent; width: 100px;"></th>
            ${theadCities}
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    // 凡例
    const legend = `
      <div style="margin-top: 24px; padding: 12px 16px; background: #f8f9fb; border-radius: 8px; display: flex; gap: 20px; font-size: 12px; color: #4b5563;">
        <span>凡例：</span>
        <span><span style="display:inline-block;width:14px;height:14px;background:rgba(15,76,92,0.08);border:2px solid #0f4c5c;border-radius:3px;vertical-align:middle;margin-right:4px;"></span>確定</span>
        <span><span style="display:inline-block;width:14px;height:14px;background:#fff;border:1px dashed #d1d5db;border-radius:3px;vertical-align:middle;margin-right:4px;"></span>未定</span>
        <span><span style="display:inline-block;width:14px;height:14px;background:#fff4e6;border:1px dashed #d97706;border-radius:3px;vertical-align:middle;margin-right:4px;"></span>休講</span>
      </div>
    `;

    // フッター
    const footer = `
      <div style="margin-top: 18px; font-size: 11px; color: #9ca3af; text-align: right;">
        エスト株式会社　｜　パワーアップ研修 年間日程調整ツール
      </div>
    `;

    wrap.innerHTML = header + table + legend + footer;
    return wrap;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  root.ExportPDF = ExportPDF;
})(window);
