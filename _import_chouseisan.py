"""
調整さん CSV を GAS の updateStatus エンドポイントへ反映するワンショットスクリプト。

前提：
- 5ファイル全て浜松LV1、2026年 8月〜12月
- 梅原薫 はアプリ側では L2 に所属（ユーザー指示）、他の人は HL1

使い方：
  py _import_chouseisan.py           # dry-run（POSTせず反映予定のみ表示）
  py _import_chouseisan.py --apply   # 実際に反映
"""
import csv, json, re, urllib.request, time, sys
from pathlib import Path

GAS_URL = 'https://script.google.com/macros/s/AKfycbzatRCFDFbBa2y3BnUocOthuS5P0K3jMYH7pc9jt6FZZ9diX2O2oOt8Akam9laFauQw/exec'
DL = Path(r'C:\Users\hakut\Dropbox\My PC (DESKTOP-2NB6VKP)\Downloads')

# 調整さん名 → アプリ側会社名（ユーザー確認済み）
NAME_MAP = {
    '大岡': '大岡',
    '白井': '白井',
    '杉浦司': '杉浦',
    '鈴木ゆ': '悠資',
    '大高旭': '大高',
    '白都卓磨': '白都',
    '大塚': '大塚',
    '梅原薫': '梅原',  # HL2 宛（ユーザー指示）
}
L2_ONLY = {'梅原'}  # この人だけ HL2 に送る、他は HL1

STATUS_MAP = {'◯': 'OK', '○': 'OK', '△': 'MAYBE', '×': 'NG'}

MONTH_FILES = {
    8: 'chouseisan (1).csv',
    9: 'chouseisan (2).csv',
    10: 'chouseisan (3).csv',
    11: 'chouseisan (4).csv',
    12: 'chouseisan (5).csv',
}
YEAR = 2026


def parse_csv(path: Path, month: int):
    with open(path, encoding='cp932') as f:
        rows = list(csv.reader(f))
    # 日程ヘッダ行を探す
    header = None
    for r in rows:
        if r and r[0].strip() == '日程':
            header = r
            break
    if not header:
        raise RuntimeError(f'{path.name}: 日程ヘッダが見つからない')
    names = [n.strip() for n in header[1:]]
    records = []
    for row in rows:
        if not row or not row[0].strip():
            continue
        head = row[0].strip()
        if head.startswith(('日程', 'コメント')) or '/' not in head:
            continue
        m = re.match(r'(\d{1,2})/(\d{1,2})', head)
        if not m:
            continue
        mm, dd = int(m.group(1)), int(m.group(2))
        date_iso = f'{YEAR}-{mm:02d}-{dd:02d}'
        for i, sym in enumerate(row[1:1 + len(names)]):
            sym = sym.strip()
            if sym in STATUS_MAP:
                records.append((date_iso, names[i], STATUS_MAP[sym]))
    return records


def fetch_companies():
    url = f'{GAS_URL}?action=bootstrap&year={YEAR}'
    d = json.loads(urllib.request.urlopen(url, timeout=60).read().decode())
    return {c['name']: c['id'] for c in d['state']['companies']}


def post_update(company_id, city_id, ym, date, status):
    body = {
        'action': 'updateStatus',
        'year': YEAR,
        'companyId': company_id,
        'cityId': city_id,
        'ym': ym,
        'date': date,
        'status': status,
    }
    req = urllib.request.Request(
        GAS_URL,
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'text/plain'},
    )
    res = urllib.request.urlopen(req, timeout=60).read().decode()
    return json.loads(res)


def main():
    dry = '--apply' not in sys.argv
    print(f"=== {'DRY-RUN' if dry else 'APPLY'} mode ===")
    companies = fetch_companies()
    print(f'アプリ側 companies: {len(companies)}社')
    # 事前チェック：マッピングに含まれる名前が全部 companies に存在するか
    missing = [v for v in NAME_MAP.values() if v not in companies]
    if missing:
        print(f'ERROR: アプリ側に存在しない会社: {missing}')
        sys.exit(1)
    plans = []
    for month, filename in MONTH_FILES.items():
        path = DL / filename
        if not path.exists():
            print(f'  SKIP {filename} (not found)')
            continue
        records = parse_csv(path, month)
        print(f'  {filename}: {len(records)} レコード')
        for date, name_csv, status in records:
            app_name = NAME_MAP.get(name_csv)
            if not app_name:
                print(f'    SKIP unknown name: {name_csv}')
                continue
            cid = companies[app_name]
            city = 'HL2' if app_name in L2_ONLY else 'HL1'
            ym = f'{YEAR}-{month:02d}'
            plans.append((cid, city, ym, date, status, app_name, name_csv))
    print(f'\n合計 {len(plans)} レコード予定\n')

    # 要約を出力
    by_city = {}
    for p in plans:
        by_city[p[1]] = by_city.get(p[1], 0) + 1
    print('都市別:', by_city)

    if dry:
        print('\n--- 先頭30件プレビュー ---')
        for p in plans[:30]:
            cid, city, ym, date, status, app_name, csv_name = p
            print(f'  [{city}] {date} {app_name:4} ({csv_name:5}) <- {status}')
        print(f'... 省略 ({len(plans) - 30} 件)')
        print('\n実行する場合は --apply フラグを付けて再実行してください。')
        return

    # APPLY — バッチエンドポイント(batchUpdateStatus)で1リクエスト一括処理
    print(f'\nバッチ適用開始（{len(plans)}件を1リクエストで送信）')
    updates = []
    for p in plans:
        cid, city, ym, date, status, app_name, csv_name = p
        updates.append({
            'companyId': cid,
            'cityId': city,
            'ym': ym,
            'date': date,
            'status': status,
        })
    body = {'action': 'batchUpdateStatus', 'year': YEAR, 'updates': updates}
    req = urllib.request.Request(
        GAS_URL,
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'text/plain'},
    )
    t0 = time.time()
    res_text = urllib.request.urlopen(req, timeout=300).read().decode()
    dt = time.time() - t0
    res = json.loads(res_text)
    print(f'経過 {dt:.1f}秒: {res}')


if __name__ == '__main__':
    main()
