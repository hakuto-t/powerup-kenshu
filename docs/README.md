# エスト パワーアップ研修 年間日程調整ツール

5都市（浜松L1・浜松L2・静岡・横浜・栃木）で月1回、講師 小澤さんで開催するパワーアップ研修の年間日程（2026年8月〜2027年7月、全11回）を、参加会社＋講師が**調整さん風UI**で共同編集しながら決め切るためのツール。

## 特徴

- **共通URL1本**にアクセス→自分で会社名を追加→カレンダーの○/△/×を入力（調整さん風）
- **月間カレンダー**：小澤候補帯外はグレーアウト、候補帯内には他研修バッジ・他都市先約バッジが自動表示
- **最小譲歩レコメンド**：「◯◯社が△→○にすれば決まる」をサイドパネルに提示
- **小澤希望判定**：連日回避・同週推奨・1日置き宝くじラッキーを自動評価、リアルタイムバッジ
- **都市間状態共有**：他都市で確定した日は🔒で表示、ルール判定に反映
- **3秒ポーリングでリアルタイム同期**：他の人の入力が数秒で全員に反映
- **LINE貼付テキスト / PDF出力**：確定スケジュールをワンクリックで書き出し

## アーキテクチャ

```
GitHub Pages (静的フロント)
  └ fetch ──► Google Apps Script (Web App)
               ├ 他研修スプシ（2026年/2027年）を read-only 読み取り
               └ 状態保存スプシ（新規作成）に読み書き
```

## デプロイ手順（Phase 0 後の実作業）

### 1. 状態保存スプシを新規作成
- Google Drive で新規スプシ作成：`エスト_パワーアップ研修_状態_2026年度`
- スプシIDをメモ（URLの `/spreadsheets/d/<ID>/edit` の部分）

### 2. GASプロジェクトを作成
1. `script.google.com` で新規プロジェクトを作成（名前例：`powerup-kenshu-backend`）
2. ローカル `gas/` 配下のファイルをコピペ：
   - `Code.gs` → `コード.gs`（既存を置き換え）
   - 「ファイル追加」で `sheets-reader.gs` `state-store.gs` を追加
   - プロジェクト設定の `appsscript.json` を `gas/appsscript.json` で置き換え（`表示`→`マニフェストファイルを表示`）
3. 「プロジェクトの設定」→「スクリプトプロパティ」で以下を設定：
   - `OTHER_SHEET_2026` = `1eMVgggO6lXiRs4pbTRLch6Wg4CpibPmdqYz0syXGS7I`
   - `OTHER_SHEET_2027` = `1fZovD5c-Pn3eggwU_kYrqEF_d_lOHuOkqHEnpnwRRck`
   - `STATE_SHEET` = （上で作ったスプシのID）
   - `ADMIN_PASSWORD_HASH` = （下記の手順で生成した SHA-256 hex 文字列）**推奨**
     - `Code.gs` を開き、関数 `setupPrintAdminHash` の `const pw = 'change-me';` を目的のパスワードに変更して「実行」
     - 実行ログに `ADMIN_PASSWORD_HASH=<hex>` と表示されるので、その hex をコピー
     - 実行後はコード内のパスワードを消しておく（コミット回避）
   - `ADMIN_PASSWORD` = （ハッシュ化しない場合の平文フォールバック、非推奨）
4. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」：
   - 次のユーザーとして実行：**自分**（hakuto.t@）
   - アクセスできるユーザー：**全員**（URLを知っている人のみアクセス可）
5. 発行されたWebアプリURL（`https://script.google.com/macros/s/.../exec`）をコピー

### 3. フロントのGAS URLを設定
`assets/api.js` の `const GAS_URL = '';` にコピーしたURLを貼り付け。

### 4. GitHub Pages にデプロイ
1. GitHubで private repo `powerup-kenshu` を作成
2. ローカルのツールフォルダを push（`index.html` と `assets/` と `docs/` `samples/`）
3. リポジトリ設定 → Pages → `main` branch `/` から公開
4. 発行されるURL（`https://hakuto-t.github.io/powerup-kenshu/`）を各社代表にLINEで配布

## 使い方（MTG進行例）

### 各社代表（事前入力）
1. 配布されたURLをブラウザで開く
2. ヘッダーの「＋ 自分の会社を追加」ボタンで会社名を登録
3. 画面下の「参加会社一覧」テーブルで、自社の行の各日に○/△/×をクリック入力
4. 自動的にサーバー保存される（他の人にも反映）

### MTG当日（司会：小澤さん or 白都さん）
1. 対象の都市タブを選択（例：浜松L1）
2. 月間カレンダーで候補日セルをクリック → サイドパネルに参加状況・譲歩提案・小澤希望達成度が表示
3. 各社の○/△/× を話しながら更新
4. ★付き日（最小譲歩で成立）を確認しながら「この日で確定する 🔒」
5. 次の都市タブへ → 他都市の確定が自動反映される
6. 11都市月分すべて確定後、「LINE用コピー」「PDF出力」で共有

## ローカル開発

バックエンド不在でもローカルで動かせる（LocalStorage保存のみ）：

```bash
# プロジェクトフォルダで静的サーバー起動
npx serve .
# または
py -m http.server 8080
```

ブラウザで `http://localhost:8080/` を開く。

## ファイル構成

| パス | 内容 |
|---|---|
| `index.html` | UIエントリ |
| `assets/style.css` | スタイル（report-designベース） |
| `assets/app.js` | 起動・状態管理・イベント |
| `assets/scheduler.js` | スコアリング・最小譲歩・小澤判定 |
| `assets/api.js` | GAS Web API クライアント |
| `assets/storage.js` | LocalStorage |
| `assets/ui-calendar.js` | 月間カレンダー描画 |
| `assets/ui-sidepanel.js` | サイドパネル |
| `assets/ui-company-entry.js` | 調整さん風 会社追加 |
| `assets/export-line.js` | LINE貼付テキスト生成 |
| `assets/export-pdf.js` | PDF出力 |
| `assets/data/*.json` | 都市・ルール・小澤候補帯 |
| `gas/Code.gs` | GASエントリ |
| `gas/sheets-reader.gs` | 他研修スプシ読み取り |
| `gas/state-store.gs` | 状態保存スプシ読み書き |

## 設計方針

詳細は `docs/algorithm.md` とリポジトリの [プラン](../nifty-inventing-wolf.md) を参照。
