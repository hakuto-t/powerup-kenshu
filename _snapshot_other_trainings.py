"""
他研修スプシから現時点のスナップショットを取得し、
assets/data/other-trainings.json に書き戻すワンショットスクリプト。

実行後は、bootstrapHandler から months 返却を外し、
クライアントはこのJSONだけを使って動くようにする（スプシ切断）。
"""
import urllib.request, json, pathlib, datetime

GAS = 'https://script.google.com/macros/s/AKfycbzatRCFDFbBa2y3BnUocOthuS5P0K3jMYH7pc9jt6FZZ9diX2O2oOt8Akam9laFauQw/exec'

print('GASからbootstrap取得中...')
with urllib.request.urlopen(GAS + '?action=bootstrap&year=2026', timeout=60) as r:
    data = json.loads(r.read().decode('utf-8'))

if not data.get('ok'):
    raise SystemExit(f'bootstrap失敗: {data}')

months = data.get('months', [])
print(f'months数: {len(months)}')

days_dict = {}
for m in months:
    if m.get('skip'):
        continue
    for d in m.get('days', []):
        iso = d.get('date')
        entry = {}
        if d.get('holiday'):
            entry['holiday'] = d['holiday']
        if d.get('otherPrograms'):
            entry['otherPrograms'] = d['otherPrograms']
        if entry:
            days_dict[iso] = entry

out = {
    'note': '他研修スケジュールのスナップショット。'
            '本番環境では GAS はこれを参照せず、フロント側 (index.html 配下) がこの JSON を直読みする設計。'
            '他研修スプシからは切り離されているため、あちら側の変更は自動反映されない。'
            '内容を更新したい場合は _snapshot_other_trainings.py を再実行してコミット。',
    'snapshotAt': datetime.datetime.now().isoformat(timespec='seconds'),
    'source': {
        '2026': '1eMVgggO6lXiRs4pbTRLch6Wg4CpibPmdqYz0syXGS7I（2026年度スプシからの抽出 — 切断後は参照しない）',
        '2027': '1fZovD5c-Pn3eggwU_kYrqEF_d_lOHuOkqHEnpnwRRck（2027年度スプシからの抽出 — 切断後は参照しない）',
    },
    'days': days_dict,
}

out_path = pathlib.Path(__file__).parent / 'assets' / 'data' / 'other-trainings.json'
# 人が読みやすいよう、days は ISO 日付でソート
out['days'] = dict(sorted(days_dict.items()))

# JSONを手で整形（日付キーを1行ずつに）
lines = [
    '{',
    f'  "note": {json.dumps(out["note"], ensure_ascii=False)},',
    f'  "snapshotAt": {json.dumps(out["snapshotAt"])},',
    '  "source": ' + json.dumps(out['source'], ensure_ascii=False, indent=4).replace('\n', '\n  ') + ',',
    '  "days": {',
]
day_items = list(out['days'].items())
for i, (iso, entry) in enumerate(day_items):
    comma = ',' if i < len(day_items) - 1 else ''
    lines.append(f'    {json.dumps(iso)}: {json.dumps(entry, ensure_ascii=False)}{comma}')
lines.append('  }')
lines.append('}')
lines.append('')

out_path.write_text('\n'.join(lines), encoding='utf-8')
print(f'書き出し完了: {out_path}')
print(f'抽出した日数: {len(days_dict)}')
