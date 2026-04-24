# HANDOVER.md — エスト パワーアップ研修 年間日程調整ツール

最終更新：2026-04-24（v5.1 MANUAL_ADDITIONS追加）

本ツールは「2026年8月〜2027年7月・5都市・全11回」の小澤さん研修について、各社代表が○△×を持ち寄って日程調整するWebアプリ。URLを配布するだけで誰でも使える／完全自動保存／リアルタイム同期。

---

## 1. ひと目で分かるURL一覧

| 用途 | URL / ID | 備考 |
|---|---|---|
| **本番ツールURL**（各社代表に配布） | https://hakuto-t.github.io/powerup-kenshu/ | GitHub Pages 公開中 |
| GitHub リポジトリ | https://github.com/hakuto-t/powerup-kenshu | public（会社名のみで機密度低） |
| GAS Web App URL | https://script.google.com/macros/s/AKfycbzatRCFDFbBa2y3BnUocOthuS5P0K3jMYH7pc9jt6FZZ9diX2O2oOt8Akam9laFauQw/exec | api.jsに埋込済、v5 現行 |
| GAS エディタ | https://script.google.com/d/1PncjHDxTCCBlzDyBE6E2sYvVpl5rD1FSr88-4aYXlH5mTDnVY8Wq9H9w/edit | 個人アカウント所有 |
| 状態保存スプシ | `エスト_パワーアップ研修_状態_2026年度` | GAS `oneTimeSetup()` が自動生成、STATE_SHEET プロパティにID保存 |
| 他研修スプシ 2026年 | `1eMVgggO6lXiRs4pbTRLch6Wg4CpibPmdqYz0syXGS7I` | **v5 で接続切断**、`_snapshot_other_trainings.py` で再取得する時のみ参照 |
| 他研修スプシ 2027年 | `1fZovD5c-Pn3eggwU_kYrqEF_d_lOHuOkqHEnpnwRRck` | 同上 |
| ローカル開発 | `C:\Users\hakut\Dropbox\My PC (DESKTOP-2NB6VKP)\Desktop\CURSOR_PJ\エスト_パワーアップ研修日程調整ツール\` | Dropbox同期 |

---

## 2. 認証情報

| 項目 | 値 | 注意 |
|---|---|---|
| **GAS 所有アカウント** | `8910hakuto@gmail.com`（個人） | 将来的に hakuto.t@hakuto-k.jp へ移行推奨 |
| GitHub アカウント | `hakuto-t` | |
| **管理者パスワード**（ツール内） | `1234` | SHA-256でスクリプトプロパティ保存。本番投入前に変更推奨 |
| 管理者セッション有効期限 | **30分**（自動失効） | ブラウザ閉じても消える |

### 管理者パスワード変更方法（運用中にも可能）
```bash
curl -X POST \
  -H "Content-Type: text/plain" \
  -d '{"action":"setPassword","currentAdminPw":"1234","newPw":"new-strong-password"}' \
  'https://script.google.com/macros/s/AKfycbzatRCFDFbBa2y3BnUocOthuS5P0K3jMYH7pc9jt6FZZ9diX2O2oOt8Akam9laFauQw/exec'
```
または GASエディタで `setAdminPassword` 関数の `pw` を書き換えて手動実行。

### 管理者パスワードを忘れた場合
GASエディタで PropertiesService から直接再設定：
1. GAS エディタ → 「プロジェクトの設定」→「スクリプトプロパティ」
2. `ADMIN_PASSWORD_HASH` を削除、`ADMIN_PASSWORD` に平文パスワードを暫定設定
3. または `oneTimeSetup` を再実行 → `admin1234` がデフォルトで設定される

---

## 3. アーキテクチャ概要（v5）

```
[各社代表ブラウザ] ──fetch──▶ [GitHub Pages フロント]
                                   │  ├─ assets/data/other-trainings.json（他研修スナップショット134日分・切断運用）
                                   │  ├─ assets/data/ozawa-range.json（小澤希望帯）
                                   │  └─ assets/data/cities.json, rules.json
                                   │
                                   └──fetch──▶ [GAS Web App /exec]
                                                 └─▶ 状態保存スプシ（read/write）

※ v5 で他研修スプシへの直接接続は廃止。JSONスナップショットのみを信頼。
```

- **フロント**：`index.html` + `assets/*.{js,css,json}`（Vanilla JS、ビルド不要）
- **バックエンド**：Google Apps Script Web App（doGet/doPost）
- **データ**：Google Sheets 1種（状態保存スプシ=読み書き）。他研修情報はフロント側 JSON 固定
- **認証**：URL公開制、管理者操作のみパスワード保護
- **同期**：5秒間隔ポーリング、`LockService` で書き込み直列化、`version` 単調増加で差分検知

---

## 4. 日常運用

### 4-1. 会社リストの管理

- **現在の登録**：代表者名24名が事前登録済み（浜松L1/L2・静岡・栃木・横浜に振り分け）
  - 白都・悠資は HL1+HL2、梅原は HL2+SZ に重複参加
  - 登録内容は GAS 経由で状態スプシに保存済み、全ユーザーに共有
- **追加**：ツールヘッダーの「＋ 自分の会社を追加」（誰でも可）、またはルートの `_register_companies.py` で一括登録
- **削除**：管理者ログイン（⚙ → パスワード `1234`）→ 参加会社一覧の ✕ ボタン
- **変更**：「削除 → 新しい名前で再追加」で対応（編集UIは無い）

### 4-2. 事前登録済みのリスト（2026年度）

| 都市 | 代表者名 |
|---|---|
| 浜松L1 | 白都 / 悠資 / 大岡 / 杉浦 / 大塚 / 大高 / 白井 |
| 浜松L2 | 白都 / 悠資 / 梅原 |
| 静岡 | 佐藤 / 寺田 / 小田 / 安藤 / 梅原 |
| 栃木 | 奈津美 / 福田 / 山川 / 掛布 / 川又 |
| 横浜 | 大石 / 大和田 / 地主 / 田中 / 出口 / 上嶋 / 横山 |

### 4-3. MTG 進行手順

1. 対象都市のタブを選択（例：浜松L1）
2. 月タブで対象月を選択
3. 各候補日セルをクリック → 右サイドパネルで参加状況確認
4. 「参加会社一覧（都市別）」が**自動で当該都市だけ展開**された状態で下に表示される
5. 各社に ○△× を議論しながら更新してもらう
6. ★印（最小譲歩で成立）の日を確認しつつ交渉
7. 合意したら右パネルの「この日で確定する🔒」
8. 他都市のMTGでは、確定済み日が🔒バッジで自動表示される

### 4-4. 参加会社一覧（都市別アコーディオン）

- cities.json 順で 5都市グループに自動ソート
- 都市タブを切り替えると、その都市のグループが自動で展開、他は折りたたみ
- ツールバー3ボタン：「＋ 全部ひらく」「− 全部とじる」「▼ いま選んでる都市だけ開く」
- ヘッダーに色ドット・社数バッジ・確定進捗・「いま対象」タグ表示
- MTG中は対象都市だけ開いた状態で使うとスッキリ

### 4-5. 使い方マニュアル（ユーザー向け）

ヘッダー右上の「？使い方」ボタンでポップアップ表示。PC苦手な司会者向けに3ステップビジュアルで簡略化済（中身は `index.html` の `modal-help` セクション）。運営側で文言変更する場合はそこを編集。

### 4-6. 保存の仕組み

**完全自動保存です。手動保存ボタンはありません。**
- ○△×をクリック／確定ボタン／会社追加の**瞬間**に GAS → 状態保存スプシへ書き込み
- 同時に LocalStorage にも保存（オフライン時のバックアップ）
- 他ユーザーの更新は **5秒ポーリング** で差分同期
- ヘッダー右上「接続中」=緑＝クラウド同期中／「オフライン」=赤＝ローカルのみ

### 4-7. 出力

- **LINE**：ヘッダーの「LINE用コピー」→ 自動でクリップボード
- **PDF**：ヘッダーの「PDF出力」→ A4横の年間スケジュール表を保存（html2canvas + jsPDF）

---

## 5. 既知の制限・本番運用で注意

### 5-1. Web App は URL公開制
- URL を知っている人は誰でも読み書き可能（`ANYONE_ANONYMOUS`）
- **管理者操作のみパスワード保護**（確定解除・他社行削除）
- URL 漏洩リスク：信頼できるLINEグループ等でのみ配布

### 5-2. 管理者パスワードが `1234`
- デフォルト値のまま。本格運用前に**強いパスワードへ変更推奨**（§2参照）

### 5-3. GAS 個人アカウント所有
- GAS と状態保存スプシが `8910hakuto@gmail.com`（個人アカウント）所有
- 将来的に仕事アカウント `hakuto.t@hakuto-k.jp` へ移行推奨（30分程度の作業）
- **推奨：状態スプシを共有ドライブに移動**して単一障害点を除去（STATE_SHEET プロパティのID参照は不変）

### 5-4. GAS クォータ
- 無料枠：実行時間6時間/日、URL fetch 20,000回/日
- **想定負荷**：16端末 × 90分MTG ÷ 5秒 = 17,280実行/MTG（約19%消費）
- **1日に2都市以上のMTGは枠超過リスク** → MTGは1日1都市推奨
- v5 で他研修スプシ読み取りを廃止したため、openById 呼び出しはゼロ（前より枠に余裕）

### 5-5. データバックアップ
- 状態保存スプシは Google Drive バージョン履歴で自動バックアップ
- 監査ログシート（`log` タブ）が state 更新ごとに追記
- **推奨：週1回スプシのコピーを取る**（ゴミ箱30日以内なら復元可）
- さらに推奨：週次で `state` シートの JSON を別シートへコピーする GAS トリガを仕込む

### 5-6. 他研修情報は固定スナップショット
- v5 から他研修スプシとの接続は切断。`assets/data/other-trainings.json`（134日分）だけを参照
- 他研修スプシ側に更新が入っても**自動反映されない**
- 取り込みたい時はルートの `_snapshot_other_trainings.py` を実行 → `git push`

### 5-7. スプシに載らない手動追加研修（MANUAL_ADDITIONS）
- 他研修スプシに載っていない研修（例：代表者特別研修など）は、`_snapshot_other_trainings.py` 冒頭の `MANUAL_ADDITIONS` 辞書に登録する運用
- スナップショット再実行時も自動でマージされるため、「手動追加分が上書きで消える」事故が起きない
- 追加方法：
  ```python
  MANUAL_ADDITIONS = {
      '2026-08-10': {'otherPrograms': [{'column': '代表者特別研修', 'name': '代表者特別研修（東京）'}]},
      ...
  }
  ```
- マージ仕様：`name` 一致で重複排除（冪等）、既存 `otherPrograms` には追加マージ、`holiday` はスプシ側を優先
- JSON直編集でも一時的には反映できるが、**必ず MANUAL_ADDITIONS にも同じ内容を書いておく**。直編集だけで済ませると次回スナップショット取得で消える

---

## 6. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| ヘッダーに「オフライン」表示 | GAS 通信不可 or ネット切断 | 5秒待って復帰しなければ F5、それでもダメなら GAS エディタで疎通確認 |
| ブラウザリロードしても状態が戻らない | LocalStorage キャッシュ残留 | 「閲覧履歴のクリア」→ localStorage 削除 |
| 確定したのに他都市から🔒バッジが見えない | ポーリング5秒遅延 | 5秒後に再確認、それでもダメならリロード |
| 「ハード制約違反」赤バナーが出る | 他都市と同日 or 連日禁止ペア | 候補日を見直す、強行する場合は確認ダイアログで進める |
| 管理者ログインできない | パスワード間違い or セッション30分切れ | 再ログインで即解決 |
| 他研修バッジが古い | スプシ接続切断後の更新が未取込 | `py _snapshot_other_trainings.py` 実行 → コミット・push |
| PDF出力が文字化け | （既知問題は解消済み） | html2canvas による画像化済み |
| アコーディオンが開かない | ブラウザの details 要素未対応（古すぎるIE） | Chrome/Edge/Safari 最新版で使用 |

---

## 7. 年度切替手順（2027-08〜、約1年後）

1. **他研修スナップショットの取り直し**（切断運用なので自動反映されない）
   - 他研修スプシに 2027年度シートが追加されたのを確認
   - `_snapshot_other_trainings.py` を再実行 → `assets/data/other-trainings.json` 更新
2. `assets/data/ozawa-range.json` を翌年度の候補帯に書き換え
3. `gas/sheets-reader.gs` の `OZAWA_RANGES` も同様に更新（将来の再スナップショット用）
4. 状態保存スプシは前年度のを残しつつ、新規作成する仕組み（`STATE_SHEET` プロパティをクリア → 次回 `oneTimeSetup` で新規生成）
5. 会社リストを次年度版で再登録（`_register_companies.py` の REG を更新して実行）
6. `assets/api.js` の `FISCAL_YEAR` を 2027 に変更
7. `clasp push && clasp deploy --deploymentId <既存ID> --description "v6: 2027年度対応"` で GAS 更新
8. `git commit && git push` → GitHub Pages 自動反映

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
clasp deploy --deploymentId AKfycbzatRCFDFbBa2y3BnUocOthuS5P0K3jMYH7pc9jt6FZZ9diX2O2oOt8Akam9laFauQw --description "..."
clasp deployments                          # デプロイ一覧
clasp open                                 # GAS エディタを開く
```

### 便利スクリプト（ルート直下）

| スクリプト | 用途 | いつ実行 |
|---|---|---|
| `_register_companies.py` | 代表者名を GAS 経由で一括事前登録 | 年度初めの1回 or リスト変更時 |
| `_snapshot_other_trainings.py` | 他研修スプシから最新スナップショットを取得し JSON 更新 | 他研修スプシに大きな変更が入った時のみ |

---

## 9. ファイル構成（v5）

```
エスト_パワーアップ研修日程調整ツール/
├── index.html                    # フロントエントリ
├── HANDOVER.md                   # このファイル（運用引継ぎ）
├── README_フォルダ構成.md         # 日本語ガイド
├── _register_companies.py        # 会社一括登録ワンショット
├── _snapshot_other_trainings.py  # 他研修JSONスナップショット取得ワンショット
├── .gitignore
├── assets/
│   ├── style.css                 # 全画面スタイル（使い方モーダル等含む）
│   ├── app.js                    # 起動・状態管理・全イベント配線
│   ├── api.js                    # GAS Web API クライアント
│   ├── storage.js                # LocalStorage キャッシュ
│   ├── scheduler.js              # ランキング・最小譲歩・小澤希望判定
│   ├── ui-calendar.js            # 月カレンダー描画
│   ├── ui-sidepanel.js           # サイドパネル
│   ├── ui-company-entry.js       # 会社追加モーダル・都市別アコーディオン
│   ├── export-line.js            # LINE貼付テキスト生成
│   ├── export-pdf.js             # PDF出力（html2canvas + jsPDF）
│   └── data/
│       ├── cities.json           # 5都市マスタ
│       ├── rules.json            # ソフト制約重み
│       ├── ozawa-range.json      # 小澤候補帯
│       ├── companies-preset.json # プリセット会社（現在はGAS側で管理、空）
│       └── other-trainings.json  # 他研修スナップショット（134日分、v5切断後の唯一の情報源）
├── gas/
│   ├── .clasp.json               # GASプロジェクトID
│   ├── appsscript.json           # GASマニフェスト
│   ├── Code.gs                   # doGet/doPost ルーター
│   ├── sheets-reader.gs          # 【v5未使用】他研修スプシ読み取り（保守用温存）
│   └── state-store.gs            # 状態保存スプシ読み書き
├── サンプル/
│   └── sample-state.json         # デモ用
└── ドキュメント/
    ├── README.md                 # プロジェクト概要・デプロイ手順
    └── algorithm.md              # スコアリング式
```

> フォルダ命名方針：`assets/`・`gas/` はコード参照が多いため英語維持、`ドキュメント/`・`サンプル/` は日本語化。詳細は `README_フォルダ構成.md` 参照。

---

## 10. 対応履歴

| 日付 | 事象 | 対応 |
|---|---|---|
| 2026-04-23 | 初期構築完了 | Phase 0〜3 全機能実装、ローカル動作確認 |
| 2026-04-23 | hakuto.t@hakuto-k.jp で 2段階認証の Device Prompt が突破できない | 個人アカウント `8910hakuto@gmail.com` で GAS 作り直し |
| 2026-04-23 | v2 setPassword API 追加＋パスワードを 1234 に変更 | |
| 2026-04-23 | 4エージェント運用検証＋v3修正 | ポーリング5秒、軽量レスポンス、入力バリデーション、CacheService、管理者セッション30分期限、LocalStorage オフライン検出 |
| 2026-04-23 | v4 修正（検証エージェント指摘） | unconfirm 時に `selectedDate` も null リセット、state 完全クリーン化 |
| 2026-04-23 | v5 大型リファクタ | (1) 代表者名24名事前登録 / (2) 使い方モーダル追加（PC苦手な司会者向け3ステップ） / (3) 参加会社一覧を都市別アコーディオン化 / (4) 他研修スプシ接続切断 → JSONスナップショット運用 / (5) フォルダ日本語化（docs→ドキュメント、samples→サンプル、README_フォルダ構成.md 追加） |
| 2026-04-24 | 代表者特別研修3日分追加 | 2026-08-10(月) / 09-25(金) / 10-19(月) 東京某所を他研修として追加。合わせて `_snapshot_other_trainings.py` に `MANUAL_ADDITIONS` 機構を実装し、スナップショット再実行時にも手動追加分が自動マージされる恒久運用に変更（§5-7） |

---

## 11. 問い合わせ・連絡先

- 開発者：白都（`hakuto.t@hakuto-k.jp`）
- GitHub：https://github.com/hakuto-t
- このドキュメントの最新版は常に本リポジトリ `HANDOVER.md`

---

## 12. 引き継ぎチェックリスト

次の担当者に引き渡す前に確認すべき項目：

- [ ] **本番URL** https://hakuto-t.github.io/powerup-kenshu/ をブラウザで開いて動作確認
- [ ] **管理者ログイン** `1234` で入れるか、必要なら強いパスワードに変更（§2）
- [ ] **状態保存スプシ** を GASエディタの「プロジェクトの設定」→「スクリプトプロパティ」の `STATE_SHEET` から開き、バックアップ手順を共有
- [ ] **共有ドライブへの移動**（推奨）：状態スプシを個人MyDriveから組織の共有ドライブへ移動すると単一障害点を除去可能
- [ ] **会社リスト** 4-2 のリストと実運用リストの差分確認
- [ ] **年度切替時期**（2027-08頃）のカレンダー登録
- [ ] **MTG運用ルール** 1日1都市を共有（GASクォータ対策）
