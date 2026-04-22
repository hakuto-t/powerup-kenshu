/* storage.js — LocalStorageキャッシュ層 */
(function (root) {
  'use strict';

  const KEY = 'powerup-kenshu:2026:state';
  const ME_KEY = 'powerup-kenshu:2026:me';
  const ADMIN_KEY = 'powerup-kenshu:2026:admin';

  const Storage = {
    loadState() {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    saveState(state) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...state, _cachedAt: new Date().toISOString() }));
      } catch (e) {
        console.warn('LS save failed', e);
        if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
          // 古い meetingLog 等を切り詰めて再試行
          try {
            const trimmed = { ...state, meetingLog: (state.meetingLog || []).slice(-20) };
            localStorage.setItem(KEY, JSON.stringify(trimmed));
          } catch (e2) {
            console.error('LS save retry failed', e2);
          }
        }
      }
    },

    // 「自分の会社」識別子（ブラウザごと）
    getMe() {
      try {
        const raw = localStorage.getItem(ME_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    setMe(companyId, companyName) {
      localStorage.setItem(ME_KEY, JSON.stringify({ companyId, companyName, setAt: new Date().toISOString() }));
    },
    clearMe() { localStorage.removeItem(ME_KEY); },

    // 管理者ログイン状態
    isAdmin() { return localStorage.getItem(ADMIN_KEY) === '1'; },
    setAdmin(on, pw) {
      if (on) {
        localStorage.setItem(ADMIN_KEY, '1');
        // sessionStorage にのみパスワードを保持（閉じたら消える）
        if (pw) sessionStorage.setItem('powerup-kenshu:adminPw', pw);
      } else {
        localStorage.removeItem(ADMIN_KEY);
        sessionStorage.removeItem('powerup-kenshu:adminPw');
      }
    },
    getAdminPw() { return sessionStorage.getItem('powerup-kenshu:adminPw'); },
  };

  root.Storage = Storage;
})(window);
