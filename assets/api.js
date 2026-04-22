/* api.js — GAS Web API クライアント */
(function (root) {
  'use strict';

  // GAS Web App URL（個人アカウントでデプロイ済み）
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbzatRCFDFbBa2y3BnUocOthuS5P0K3jMYH7pc9jt6FZZ9diX2O2oOt8Akam9laFauQw/exec';
  // 年度（翌年度移行時はこの定数のみ変更）
  const FISCAL_YEAR = 2026;

  async function postJson(body) {
    if (!GAS_URL) return { ok: false, offline: true };
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // CORS preflight 回避
      body: JSON.stringify(body),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function getJson(action, extra) {
    if (!GAS_URL) return null;
    const qs = new URLSearchParams({ action, year: String(FISCAL_YEAR), ...(extra || {}) });
    const res = await fetch(`${GAS_URL}?${qs.toString()}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  const Api = {
    fiscalYear: FISCAL_YEAR,
    hasBackend() { return !!GAS_URL; },

    async getBootstrap() { return getJson('bootstrap'); },

    async pollState(since, sinceVersion) {
      // 変更があるかだけを問い合わせる軽量呼び出し
      const extra = { lite: '1' };
      if (since) extra.since = since;
      if (sinceVersion !== undefined && sinceVersion !== null) extra.sinceVersion = String(sinceVersion);
      return getJson('state', extra);
    },

    async saveState(state) {
      return postJson({ action: 'save', year: FISCAL_YEAR, state });
    },

    async addCompany(company) {
      return postJson({ action: 'addCompany', year: FISCAL_YEAR, company });
    },

    async updateStatus(payload) {
      return postJson({ action: 'updateStatus', year: FISCAL_YEAR, ...payload });
    },

    async confirmAssignment(cityId, year, month, date, adminPw) {
      return postJson({
        action: 'confirm',
        year: FISCAL_YEAR,
        cityId,
        ym: `${year}-${String(month).padStart(2, '0')}`,
        date,
        adminPw,
      });
    },

    async unconfirmAssignment(cityId, year, month, adminPw) {
      return postJson({
        action: 'confirm',
        unconfirm: true,
        year: FISCAL_YEAR,
        cityId,
        ym: `${year}-${String(month).padStart(2, '0')}`,
        adminPw,
      });
    },
  };

  root.Api = Api;
})(window);
