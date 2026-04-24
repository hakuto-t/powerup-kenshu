/* scheduler.js — ランキング・最小譲歩・小澤希望判定 */
(function (root) {
  'use strict';

  const DAY_MS = 86400000;

  const Util = {
    parseDate(iso) { return new Date(iso + 'T00:00:00+09:00'); },
    fmt(iso) {
      const d = Util.parseDate(iso);
      const wd = '日月火水木金土'[d.getDay()];
      return `${d.getMonth() + 1}/${d.getDate()}(${wd})`;
    },
    weekday(iso) { return Util.parseDate(iso).getDay(); },
    isWeekend(iso) { const w = Util.weekday(iso); return w === 0 || w === 6; },
    dayDiff(a, b) { return Math.round((Util.parseDate(a) - Util.parseDate(b)) / DAY_MS); },
    sameWeekISO(a, b) { return Util.isoWeekKey(a) === Util.isoWeekKey(b); },
    isoWeekKey(iso) {
      const d = Util.parseDate(iso);
      const day = (d.getDay() + 6) % 7; // Mon=0
      const thu = new Date(d); thu.setDate(d.getDate() - day + 3);
      const y = thu.getFullYear();
      const jan4 = new Date(y, 0, 4);
      const wk = Math.floor((thu - jan4) / (7 * DAY_MS)) + 1;
      return `${y}-W${String(wk).padStart(2, '0')}`;
    },
    enumerateDates(start, end) {
      const out = [];
      const s = Util.parseDate(start), e = Util.parseDate(end);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        out.push(d.toISOString().slice(0, 10));
      }
      return out;
    },
    isSameMonth(a, b) {
      const da = Util.parseDate(a), db = Util.parseDate(b);
      return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
    },
  };

  // 連日判定のハードルール
  // H3_noUTHamamatsuShizuokaAdjacent: UT×(HL1/HL2/SZ) の連日は禁止
  // それ以外は許可例外（HL1↔HL2, HL1↔SZ, HL2↔SZ）か？ユーザー明示なのは：
  //   - 連日禁止基本
  //   - ただし 浜松↔静岡 はOK
  //   - 浜松L1↔L2 は推奨（連日OK）
  // UT×YH の連日については明示なし→デフォルトの「連日禁止」に従う（YHとUTは同週推奨レベル）
  function isConsecutiveAllowed(cityA, cityB) {
    const set = new Set([cityA, cityB]);
    // 浜松系同士
    if (set.has('HL1') && set.has('HL2')) return true;
    // 浜松↔静岡
    const hamSz = (set.has('HL1') || set.has('HL2')) && set.has('SZ');
    if (hamSz) return true;
    return false;
  }
  function isBannedAdjacentPair(cityA, cityB) {
    // UT と 浜松/静岡 の連日は明確に禁止
    const set = new Set([cityA, cityB]);
    if (set.has('UT') && (set.has('HL1') || set.has('HL2') || set.has('SZ'))) return true;
    return false;
  }

  // 他研修の共存可否判定（cities.json の compatibleOtherPrograms に従う）
  //   city.compatibleOtherPrograms が未定義なら「判定不能」としてデフォルト挙動（全てNG＝ペナルティ対象）
  function isOtherProgramCompatible(city, programName) {
    if (!city || !Array.isArray(city.compatibleOtherPrograms)) return false;
    return city.compatibleOtherPrograms.includes(programName);
  }
  function splitOtherPrograms(city, otherPrograms) {
    const compat = [], incompat = [];
    for (const p of (otherPrograms || [])) {
      if (isOtherProgramCompatible(city, p.name)) compat.push(p);
      else incompat.push(p);
    }
    return { compat, incompat };
  }

  const Scheduler = {
    isOtherProgramCompatible,
    splitOtherPrograms,

    // 対象月の候補日（候補帯内のみ）を列挙。土日祝日も含む（UIでは色で示す）。
    getCandidateDates(monthData) {
      if (!monthData || !monthData.days) return [];
      return monthData.days.filter(d => d.inCandidateRange);
    },

    // 候補日ごとのスコア
    // opts.city を渡すと他研修の共存可否を考慮（共存可なら S7 ペナルティなし）
    rankCandidates(monthData, cityId, companies, assignments, weights, opts) {
      const candidates = Scheduler.getCandidateDates(monthData);
      const confirmed = assignments
        .filter(a => a.confirmed && a.selectedDate)
        .map(a => ({ cityId: a.cityId, date: a.selectedDate, year: a.year, month: a.month }));
      const city = (opts && opts.city) || null;

      return candidates.map(d => {
        const hardViolations = Scheduler.checkHard(d, cityId, confirmed);
        const soft = Scheduler.scoreSoft(d, cityId, confirmed, weights);
        const part = Scheduler.countParticipation(d.date, cityId, companies, assignments);

        // 他研修を共存可/共存不可に分け、ペナルティは共存不可のみ対象
        const { compat: compatOther, incompat: incompatOther } = splitOtherPrograms(city, d.otherPrograms);
        const otherPenalty = incompatOther.length * (weights.S7_other_training_per_item || -3);
        const weekendPenalty = (Util.isWeekend(d.date) || d.holiday) ? (weights.S8_weekend_or_holiday || -5) : 0;

        const total = hardViolations.length > 0
          ? -Infinity
          : (weights.w_participation_ok || 10) * part.ok
          + (weights.w_participation_maybe || 3) * part.maybe
          + (weights.w_participation_ng || -20) * part.ng
          + soft.total + otherPenalty + weekendPenalty;

        return {
          date: d.date,
          weekday: Util.weekday(d.date),
          holiday: d.holiday,
          otherPrograms: d.otherPrograms || [],
          compatibleOtherPrograms: compatOther,
          incompatibleOtherPrograms: incompatOther,
          totalScore: total,
          participation: part,
          softHits: soft.hits,
          hardViolations,
        };
      }).sort((a, b) => b.totalScore - a.totalScore);
    },

    checkHard(day, cityId, confirmed) {
      const violations = [];
      const date = day.date;
      for (const cf of confirmed) {
        if (cf.cityId === cityId) continue; // 同都市は月1前提
        const g = Math.abs(Util.dayDiff(date, cf.date));
        if (g === 0) violations.push(`同日重複(${cf.cityId})`);
        if (g === 1) {
          if (isBannedAdjacentPair(cityId, cf.cityId)) {
            violations.push(`連日禁止(${cityId}↔${cf.cityId})`);
          } else if (!isConsecutiveAllowed(cityId, cf.cityId)) {
            violations.push(`連日原則禁止(${cityId}↔${cf.cityId})`);
          }
        }
      }
      return violations;
    },

    scoreSoft(day, cityId, confirmed, weights) {
      const hits = [];
      const date = day.date;
      for (const cf of confirmed) {
        if (cf.cityId === cityId) continue;
        const g = Math.abs(Util.dayDiff(date, cf.date));
        const pair = new Set([cityId, cf.cityId]);
        const sw = Util.sameWeekISO(date, cf.date);

        // S1: HL1-HL2 連日
        if (g === 1 && pair.has('HL1') && pair.has('HL2')) {
          hits.push({ id: 'S1', bonus: weights.S1_HL1_HL2_consecutive || 10, label: `💡浜松L1↔L2 連日（小澤推奨）` });
        }
        // S2: YH-UT 同週
        if (sw && pair.has('YH') && pair.has('UT')) {
          hits.push({ id: 'S2', bonus: weights.S2_YH_UT_sameWeek || 8, label: `✨横浜↔宇都宮 同週` });
        }
        // S3: 浜松-SZ 同週
        if (sw && (pair.has('HL1') || pair.has('HL2')) && pair.has('SZ')) {
          hits.push({ id: 'S3', bonus: weights.S3_HamaSZ_sameWeek || 8, label: `✨浜松↔静岡 同週` });
        }
        // S4: UT → 1日空 → YH  （UT確定日の翌々日がYH、またはその逆）
        if (g === 2 && pair.has('UT') && pair.has('YH')) {
          hits.push({ id: 'S4', bonus: weights.S4_UT_gap1_YH || 20, label: `🎰宇都宮→1日挟み→横浜（宝くじ）` });
        }
        // S5: 浜松-SZ 連日 or 1日置き
        if ((g === 1 || g === 2) && (pair.has('HL1') || pair.has('HL2')) && pair.has('SZ')) {
          hits.push({ id: 'S5', bonus: weights.S5_HamaSZ_consecutive_or_gap1 || 20, label: `🎰浜松↔静岡 ${g === 1 ? '連日' : '1日置き'}（宝くじ）` });
        }
        // S6: 地理的近接
        if (g <= 2 && (pair.has('HL1') || pair.has('HL2')) && pair.has('SZ')) {
          hits.push({ id: 'S6', bonus: weights.S6_geo_close || 5, label: `移動効率（浜松-静岡）` });
        }
      }
      return { total: hits.reduce((s, h) => s + h.bonus, 0), hits };
    },

    countParticipation(dateISO, cityId, companies, assignments) {
      const relevant = companies.filter(c => !c.cityParticipation || c.cityParticipation.length === 0 || c.cityParticipation.includes(cityId));
      let ok = 0, maybe = 0, ng = 0, unknown = 0;
      for (const c of relevant) {
        const s = Scheduler.getStatusFor(c.id, cityId, dateISO, assignments);
        if (s === 'OK') ok++;
        else if (s === 'MAYBE') maybe++;
        else if (s === 'NG') ng++;
        else unknown++;
      }
      return { ok, maybe, ng, unknown, total: relevant.length };
    },

    getStatusFor(companyId, cityId, dateISO, assignments) {
      const a = assignments.find(x => x.cityId === cityId && x.year === +dateISO.slice(0, 4) && x.month === +dateISO.slice(5, 7));
      if (!a) return 'UNKNOWN';
      const s = (a.statuses || []).find(x => x.companyId === companyId && x.date === dateISO);
      return s ? s.status : 'UNKNOWN';
    },

    // 最小譲歩：ある日で1社が1ステップ改善（NG→MAYBE or MAYBE→OK）したときの総合スコア改善量を列挙
    suggestCompromises(monthData, cityId, companies, assignments, weights, topK = 3, opts) {
      const ranked = Scheduler.rankCandidates(monthData, cityId, companies, assignments, weights, opts);
      const baseTop = ranked[0]?.totalScore ?? -Infinity;

      const suggestions = [];
      const monthKey = { year: monthData.year, month: monthData.month };
      const a = assignments.find(x => x.cityId === cityId && x.year === monthKey.year && x.month === monthKey.month);
      const statuses = a ? [...(a.statuses || [])] : [];

      const relevant = companies.filter(c => !c.cityParticipation || c.cityParticipation.length === 0 || c.cityParticipation.includes(cityId));

      // 上位3日×各社×1ステップを試算
      for (const cand of ranked.slice(0, Math.min(5, ranked.length))) {
        for (const c of relevant) {
          const cur = Scheduler.getStatusFor(c.id, cityId, cand.date, assignments);
          const upgrades = cur === 'NG' ? ['MAYBE', 'OK']
                         : cur === 'MAYBE' ? ['OK']
                         : cur === 'UNKNOWN' ? ['OK'] : [];
          for (const to of upgrades) {
            // 元の assignments を破壊しないよう明示的ディープコピー
            const replaced = assignments.map(a => ({
              ...a,
              statuses: (a.statuses || []).map(s => ({ ...s })),
            }));
            let simA = replaced.find(x => x.cityId === cityId && x.year === monthKey.year && x.month === monthKey.month);
            if (!simA) {
              simA = { cityId, year: monthKey.year, month: monthKey.month, selectedDate: null, confirmed: false, statuses: [] };
              replaced.push(simA);
            }
            const idx = simA.statuses.findIndex(s => s.companyId === c.id && s.date === cand.date);
            if (idx >= 0) simA.statuses[idx].status = to;
            else simA.statuses.push({ companyId: c.id, date: cand.date, status: to });

            const reranked = Scheduler.rankCandidates(monthData, cityId, companies, replaced, weights, opts);
            const newTop = reranked[0]?.totalScore ?? -Infinity;
            const delta = newTop - baseTop;
            if (delta > 0) {
              suggestions.push({
                date: reranked[0].date,
                companyId: c.id,
                companyName: c.shortName || c.name,
                fromStatus: cur,
                toStatus: to,
                delta,
                newTotalScore: newTop,
                message: `${c.shortName || c.name}が${labelOf(cur)}→${labelOf(to)}にすれば ${Util.fmt(reranked[0].date)} が最有力に`,
              });
            }
          }
        }
      }
      // ユニークに（同じ会社×同じ日×同じtoStatusで最大delta）
      const seen = {};
      for (const s of suggestions) {
        const k = `${s.companyId}|${s.date}|${s.toStatus}`;
        if (!seen[k] || seen[k].delta < s.delta) seen[k] = s;
      }
      return Object.values(seen).sort((a, b) => b.delta - a.delta).slice(0, topK);
    },
  };

  function labelOf(s) {
    return s === 'OK' ? '○' : s === 'MAYBE' ? '△' : s === 'NG' ? '×' : '未';
  }

  root.Scheduler = Scheduler;
  root.SchedUtil = Util;
})(window);
