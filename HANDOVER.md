# HANDOVER.md — エスト パワーアップ研修 年間日程調整ツール

最終更新：2026-04-23

---

## 1. ひと目で分かるURL一覧

| 用途 | URL / ID | 備考 |
|---|---|---|
| **本番ツールURL**（各社代表に配布） | https://hakuto-t.github.io/powerup-kenshu/ | GitHub Pages 公開中 |
| GitHub リポジトリ | https://github.com/hakuto-t/powerup-kenshu | public（会社名のみで機密度低） |
| GAS Web App URL | https://script.google.com/macros/s/AKfycbzatRCFDFbBa2y3BnUocOthuS5P0K3jMYH7pc9jt6FZZ9diX2O2oOt8Akam9laFauQw/exec | api.jsに埋込済 |
| GAS エディタ | https://script.google.com/d/1PncjHDxTCCBlzDyBE6E2sYvVpl5rD1FSr88-4aYXlH5mTDnVY8Wq9H9w/edit | 個人アカウント所有 |
| 他研修スプシ 2026年 | `1eMVgggO6lXiRs4pbTRLch6Wg4CpibPmdqYz0syXGS7I` | read-only |
| 他研修スプシ 2027年 | `1fZovD5c-Pn3eggwU_kYrqEF_d_lOHuOkqHEnpnwRRck` | read-only |
| 状態保存スプシ | GAS oneTimeSetup() が自動生成 | `エスト_パワーアップ研修_状態_2026年度` |
| ローカル開発 | `C:\Users\hakut\Dropbox\My PC (DESKTOP-2NB6VKP)\Desktop\CURSOR_PJ\エスト_パワーアップ研修日程調整ツール\` | Dropbox同期 |

---

## 2. 認証情報

| 項目 | 値 | 注意 |
|---|---|---|
| **GAS 所有アカウント** | `8910hakuto@gmail.com`（個人） | 将来的に hakuto.t@hakuto-k.jp へ移行推奨 |
| GitHub アカウント | `hakuto-t` | |
| **管理者パスワード**（ツール内） | `1234` | SHA-256でスクリプトプロパティ保存 |
| 管理者セッション有効期限 | **30分**（自動失効） | ブラウザ閉じても消える |

### 管理者パスワード変更方法（運用中にも可能）
```bash
# 現パスワードで認証して新パスワードに変更
curl -X POST \
  -H "Content-Type: text/plain" \
  -d '{"action":"setPassword","currentAdminPw":"1234","newPw":"new-strong-password"}' \
  'https://script.google.com/macros/s/AKfycbzatRCFDFbBa2y3BnUocOthuS5P0K3jMYH7pc9jt6FZZ9diX2O2oOt8Akam9laFauQw/exec'
```
または GASエディタで `setAdminPassword` 関数の `pw` を書き換えて手動実行。

### 管理者パスワードを忘れた場合
GASエディタで PropertiesService から直接再設定：
1. GAS エディタを開く → 「プロジェクトの設定」→「スクリプトプロパティ」
2. `ADMIN_PASSWORD_HASH` を削除、`ADMIN_PASSWORD` に平文パスワードを暫定設定
3. または `oneTimeSetup` を再実行 → `admin1234` がデフォルトで設定される

---

## 3. アーキテクチャ概要

```
[各社代表ブラウザ] ──fetch──▶ [GitHub Pages フロント]
                                   │
                                   └──fetch──▶ [GAS Web App /exec]
                                                 ├─▶ 他研修スプシ（read-only）
                                                 └─▶ 状態保存スプシ（read/write）
```

- **フロント**：`index.html` + `assets/*.{js,css,json}`（Vanilla JS）
- **バックエンド**：Google Apps Script Web App
- **データ**：Google Sheets 2種（他研修＝読み取り、状態保存＝読み書き）
- **認証**：URL公開制、管理者操作のみパスワード保護
- **同期**：5秒間隔ポーリング、LockService で書き込み直列化

---

## 4. 日常運用

### 4-1. 会社リストを事前登録する（推奨フロー）

新しい会社を登録するには、ツールの「＋ 自分の会社を追加」ボタン、
または Python スクリプトで一括登録：

```bash
py -c "
import urllib.request, json
GAS = 'https://script.google.com/macros/s/AKfycbzatRCFDFbBa2y3BnUocOthuS5P0K3jMYH7pc9jt6FZZ9diX2O2oOt8Akam9laFauQw/exec'
companies = [
    {'name': 'A建設', 'cities': ['HL1','HL2','SZ']},
    {'name': 'B工務店', 'cities': ['YH','UT']},
    # …
]
import time, random
for c in companies:
    cid = 'co_' + str(int(time.time()*1000)) + '_' + str(random.randint(1000,9999))
    body = json.dumps({'action':'addCompany','year':2026,'company':{'id':cid,'name':c['name'],'shortName':c['name'][:8],'cityParticipation':c['cities']}}).encode('utf-8')
    req = urllib.request.Request(GAS, data=body, headers={'Content-Type':'text/plain'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode('utf-8'))
        print('added:', c['name'], 'ok:', d.get('ok'), 'dup:', d.get('duplicated'))
"
```

都市ID: `HL1`=浜松L1, `HL2`=浜松L2, `SZ`=静岡, `YH`=横浜, `UT`=栃木

### 4-2. MTG 進行手順

1. 対象都市のタブを選択（例：浜松L1）
2. 月タブで対象月を選択
3. 各候補日セルをクリック → サイドパネルで参加状況確認
4. ○△× を議論しながら更新
5. ★印（最小譲歩で成立）の日を確認しつつ、1社ずつ譲れるか交渉
6. 合意したら「この日で確定する🔒」
7. 他都市のMTGでは、確定済み日が🔒バッジで表示される

### 4-3. 出力

- **LINE**：ヘッダーの「LINE用コピー」→ 自動でクリップボードへ
- **PDF**：ヘッダーの「PDF出力」→ A4横の年間スケジュール表が保存される

---

## 5. 既知の制限・本番運用で注意

### 5-1. Web App は URL公開制
- URL を知っている人は誰でも読み書き可能（`ANYONE_ANONYMOUS` 設定）
- **管理者操作のみパスワード保護**（確定解除・他社行削除）
- URL が漏れたら、**悪意ある改ざん**のリスクあり
  - 対策：URL は信頼できるLINEグループ等でのみ配布

### 5-2. 管理者パスワードが `1234`
- デフォルト値のまま本番投入している
- 本格運用前に**強いパスワードへ変更推奨**（上記2.参照）

### 5-3. GAS 個人アカウント所有
- GAS と状態保存スプシが `8910hakuto@gmail.com`（個人アカウント）所有
- 将来的に仕事アカウント `hakuto.t@hakuto-k.jp` へ移行するのが望ましい
- 移行は clasp で再作成＋状態スプシコピー＋api.js 更新（30分程度）

### 5-4. GAS クォータ
- 無料枠：1日90,000実行、6時間/日、1スクリプト30秒/実行、URL fetch 20,000回/日
- **想定負荷**：16端末 × 90分MTG ÷ 5秒 = 17,280実行/MTG（約19%消費）
- 1日に2都市以上の MTG を行うと枠に近づく → **MTGは1日1都市推奨**
- CacheService で他研修スプシ読み取りは6時間キャッシュしているが、状態スプシ読み取りは毎回

### 5-5. データバックアップ
- 状態保存スプシは Google Drive のバージョン履歴で自動バックアップ
- 監査ログシート（`log` タブ）が更新ごとに追記される
- **週1回程度、状態スプシのコピーを取る**ことを推奨（ゴミ箱30日以内なら復元可）

---

## 6. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| ヘッダーに「オフライン」表示 | GAS 通信不可 | GAS エディタでデプロイ状態確認、URL確認 |
| ブラウザリロードしても状態が戻らない | LocalStorageキャッシュが残る | 「閲覧履歴のクリア」→ localStorage 削除 |
| 確定したのに他都市から🔒バッジが見えない | ポーリング5秒遅延 | 5秒後に再確認、それでもダメならリロード |
| 「ハード制約違反」赤バナーが出る | 他都市と同日 or 連日禁止ペアに該当 | 候補日を見直す、どうしても確定したい場合は確認ダイアログで強行 |
| 管理者ログインできない | パスワード間違い or セッション30分切れ | 再ログインで即解決 |
| 会社追加モーダルが閉じない | （既知問題は解消済み） | ESC / 背景クリック / ×ボタン / キャンセルのいずれかで閉じる |
| PDF出力が文字化け | （既知問題は解消済み） | html2canvas による画像化済み |
| 他研修バッジが出ない | 6時間キャッシュ中＋スプシアクセス不可 | GASエディタで `buildMonthsForYear(2026)` を実行→Loggerでエラー確認 |

---

## 7. 年度切替手順（2027-08〜、約1年後）

1. `assets/data/ozawa-range.json` を翌年度の候補帯に書き換え
2. `assets/data/other-trainings.json` を翌年度スプシから抽出したデータで更新（またはGAS経由で読む）
3. `gas/sheets-reader.gs` の `OZAWA_RANGES` を同様に更新
4. `gas/sheets-reader.gs` の `DEFAULT_OTHER_SHEET_*` を翌年度のIDに更新、または GAS プロパティで上書き
5. 状態保存スプシは前年度のものを残しつつ、新規作成される仕組み（`STATE_SHEET` プロパティをクリア→次回 `oneTimeSetup` で新規生成）
6. `clasp push && clasp deploy --deploymentId <既存ID>` で v4 デプロイ
7. git commit & push → GitHub Pages 自動反映

---

## 8. ローカル開発

```bash
cd "C:/Users/hakut/Dropbox/My PC (DESKTOP-2NB6VKP)/Desktop/CURSOR_PJ/エスト_パワーアップ研修日程調整ツール"
py -m http.server 8765
# → http://localhost:8765/ をブラウザで開く
# GAS_URL を assets/api.js から一時的に '' にするとローカル完結（LocalStorageのみ）で動作
```

`clasp` コマンド（個人アカウントでログイン済）：
```bash
export PATH="$PATH:/c/Users/hakut/AppData/Roaming/npm"
cd gas
clasp push -f                              # GAS へコード push
clasp deploy --deploymentId <ID> --description "..."   # 既存デプロイを更新
clasp deployments                          # デプロイ一覧
clasp open                                 # GAS エディタを開く
```

---

## 9. ファイル構成

```
エスト_パワーアップ研修日程調整ツール/
├── index.html                    # フロントエントリ
├── HANDOVER.md                   # このファイル
├── .gitignore
├── assets/
│   ├── style.css                 # スタイル（report-designベース）
│   ├── app.js                    # 起動・状態管理・イベント
│   ├── api.js                    # GAS Web API クライアント
│   ├── storage.js                # LocalStorage
│   ├── scheduler.js              # ランキング・最小譲歩・小澤希望判定
│   ├── ui-calendar.js            # 月間カレンダー描画
│   ├── ui-sidepanel.js           # サイドパネル
│   ├── ui-company-entry.js       # 会社追加モーダル・会社テーブル
│   ├── export-line.js            # LINE貼付テキスト
│   ├── export-pdf.js             # PDF出力（html2canvas + jsPDF）
│   └── data/
│       ├── cities.json           # 5都市マスタ
│       ├── rules.json            # ソフト制約重み
│       ├── ozawa-range.json      # 小澤候補帯
│       ├── companies-preset.json # プリセット会社（空、必要なら記載）
│       └── other-trainings.json  # 他研修オフラインキャッシュ
├── gas/
│   ├── .clasp.json               # GASプロジェクトID
│   ├── appsscript.json           # GASマニフェスト
│   ├── Code.gs                   # doGet/doPost ルーター
│   ├── sheets-reader.gs          # 他研修スプシA-H列読み取り
│   └── state-store.gs            # 状態保存スプシ読み書き
├── samples/
│   └── sample-state.json         # デモ用
└── docs/
    ├── README.md                 # プロジェクト概要・デプロイ手順
    └── algorithm.md              # スコアリング式
```

---

## 10. 運用で起きた過去の対応履歴（参考）

| 日付 | 事象 | 対応 |
|---|---|---|
| 2026-04-23 | 初期構築完了 | Phase 0〜3 全機能実装、ローカル動作確認 |
| 2026-04-23 | hakuto.t@hakuto-k.jp で 2段階認証の Device Prompt が突破できない | 個人アカウント `8910hakuto@gmail.com` で GAS 作り直し |
| 2026-04-23 | v2 setPassword API 追加＋パスワードを 1234 に変更 | | 
| 2026-04-23 | 4エージェント運用検証＋v3修正 | ポーリング5秒、軽量レスポンス、入力バリデーション、CacheService、管理者セッション30分期限、LocalStorage offline検出 |

---

## 11. 問い合わせ・連絡先

- 開発者：白都（`hakuto.t@hakuto-k.jp`）
- GitHub：https://github.com/hakuto-t
- このドキュメントの最新版は常に本リポジトリ `HANDOVER.md`
