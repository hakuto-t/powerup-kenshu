"""
エスト パワーアップ研修 — 会社（代表者名）一括事前登録スクリプト
2026-04-23 実行
※ 会社名欄にはすべて代表者名（全員が会社代表）を入れる
"""
import urllib.request, urllib.error, json, time, random, sys

GAS = 'https://script.google.com/macros/s/AKfycbzatRCFDFbBa2y3BnUocOthuS5P0K3jMYH7pc9jt6FZZ9diX2O2oOt8Akam9laFauQw/exec'

# 浜松L1=HL1, 浜松L2=HL2, 静岡=SZ, 横浜=YH, 栃木=UT
REG = {
    'HL1': ['白都', '悠資', '大岡', '杉浦', '大塚', '大高', '白井'],
    'HL2': ['白都', '悠資', '梅原'],
    'SZ':  ['佐藤', '寺田', '小田', '安藤', '梅原'],
    'UT':  ['奈津美', '福田', '山川', '掛布', '川又'],
    'YH':  ['大石', '大和田', '地主', '田中', '出口', '上嶋', '横山'],
}

# 名前 → 参加都市リストに集約（同名は複数都市に参加扱い）
by_name = {}
for city, names in REG.items():
    for n in names:
        by_name.setdefault(n, []).append(city)

print(f'登録対象: {len(by_name)} 名（延べ {sum(len(v) for v in REG.values())} 参加）')

ok_count = 0
dup_count = 0
err_count = 0

for name, cities in by_name.items():
    cid = 'co_' + str(int(time.time() * 1000)) + '_' + str(random.randint(1000, 9999))
    time.sleep(0.02)  # id衝突回避のわずかな遅延
    body = {
        'action': 'addCompany',
        'year': 2026,
        'company': {
            'id': cid,
            'name': name,
            'shortName': name[:8],
            'cityParticipation': cities,
        }
    }
    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(GAS, data=data, headers={'Content-Type': 'text/plain'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.loads(r.read().decode('utf-8'))
            if res.get('duplicated'):
                dup_count += 1
                print(f'  - {name:8s} [{",".join(cities)}] DUPLICATE')
            elif res.get('ok'):
                ok_count += 1
                print(f'  + {name:8s} [{",".join(cities)}] OK')
            else:
                err_count += 1
                print(f'  ! {name:8s} ERROR: {res}')
    except Exception as e:
        err_count += 1
        print(f'  ! {name:8s} EXCEPTION: {e}')

print()
print(f'結果: 新規 {ok_count} / 重複スキップ {dup_count} / エラー {err_count}')
sys.exit(0 if err_count == 0 else 1)
