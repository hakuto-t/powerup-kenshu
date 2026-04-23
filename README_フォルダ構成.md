# フォルダ構成（日本語ガイド）

エスト パワーアップ研修 年間日程調整ツール のフォルダ構成を日本語で整理したガイドです。

## 公開URL

- **本番ツール**: https://hakuto-t.github.io/powerup-kenshu/
- **GitHub リポジトリ**: https://github.com/hakuto-t/powerup-kenshu
- **GAS Web App**: `https://script.google.com/macros/s/AKfycbzatRCFDFbBa2y3BnUocOthuS5P0K3jMYH7pc9jt6FZZ9diX2O2oOt8Akam9laFauQw/exec`

## ディレクトリ地図

```
エスト_パワーアップ研修日程調整ツール/
├── index.html                  … フロントエントリ（GitHub Pages が公開する本体）
├── HANDOVER.md                 … 運用引継ぎ（URL・認証情報・運用手順）
├── README_フォルダ構成.md      … このファイル
├── .gitignore
│
├── assets/                     ★フロントエンド一式（JS / CSS / データ）
│   ├── style.css               … 全画面スタイル
│   ├── app.js                  … 起動・状態管理・全イベント配線
│   ├── api.js                  … GAS Web API クライアント（通信層）
│   ├── storage.js              … ブラウザ LocalStorage キャッシュ
│   ├── scheduler.js            … 日程スコアリング（最小譲歩・★ロジック）
│   ├── ui-calendar.js          … 月カレンダー描画
│   ├── ui-sidepanel.js         … サイドパネル（○△×編集）描画
│   ├── ui-company-entry.js     … 会社追加モーダル＋会社テーブル描画
│   ├── export-line.js          … LINE貼り付け用テキスト生成
│   ├── export-pdf.js           … PDF出力（html2canvas + jsPDF）
│   └── data/                   … マスタ・プリセットデータ
│       ├── cities.json         … 5都市マスタ（浜松L1/L2、静岡、横浜、栃木）
│       ├── rules.json          … ソフト制約の重み
│       ├── ozawa-range.json    … 小澤さん希望帯（月別）
│       ├── companies-preset.json … 事前登録プリセット（現在はGAS側で管理）
│       └── other-trainings.json  … 他研修オフラインキャッシュ
│
├── gas/                        ★バックエンド（Google Apps Script）
│   ├── Code.gs                 … doGet / doPost ルーター＋CRUDハンドラ
│   ├── sheets-reader.gs        … 他研修スプシ読み取り
│   ├── state-store.gs          … 状態保存スプシ読み書き
│   ├── appsscript.json         … GASマニフェスト
│   └── .clasp.json             … claspプロジェクトID
│
├── ドキュメント/               … 設計資料
│   ├── README.md               … プロジェクト概要・デプロイ手順
│   └── algorithm.md            … スコアリング式
│
└── サンプル/                   … デモ用サンプルデータ
    └── sample-state.json
```

## フォルダの役割早見表

| フォルダ | 日本語での意味 | 中身 |
|---|---|---|
| `assets/` | フロントエンド一式 | HTMLから呼ぶ JS / CSS / データ |
| `assets/data/` | マスタ・プリセット | JSON で保持する設定類 |
| `gas/` | バックエンド（Google Apps Script） | サーバー側コード |
| `ドキュメント/` | 資料 | README・アルゴリズム解説 |
| `サンプル/` | サンプル | デモ用データ |

> **なぜ `assets/` と `gas/` は英語のままか**
> これらは HTML / JavaScript / clasp 設定から多数参照されており、名前を変えるとデプロイ済みサイトが動かなくなります。運用リスクを避けるため、英語名のまま維持しています。

## 運用に必要な情報の場所

| 知りたいこと | 参照先 |
|---|---|
| URL一覧・パスワード・認証情報 | `HANDOVER.md` §1-2 |
| 運用手順（MTGの進め方） | `HANDOVER.md` §4 |
| 既知の制限・注意点 | `HANDOVER.md` §5 |
| トラブル対処 | `HANDOVER.md` §6 |
| 年度切替（2027-08〜） | `HANDOVER.md` §7 |
| ローカル開発環境 | `HANDOVER.md` §8 |
| スコアリングの計算式 | `ドキュメント/algorithm.md` |

## データの流れ（ざっくり）

```
[各社代表ブラウザ]
    ↓  (1) index.html を取得
[GitHub Pages]
    ↓  (2) assets/ 配下を順次ロード
[ブラウザ上でアプリ起動]
    ↓  (3) GAS Web App に bootstrap GET
[GAS Code.gs]
    ↓  (4) 状態スプシから state を読み込み返却
[ブラウザで表示・編集]
    ↓  (5) 変更のたびに自動保存 POST（save / addCompany / updateStatus / confirm）
[GAS → 状態スプシに保存]
    ↓  (6) 他ブラウザは5秒間隔でポーリング → 差分検知 → 再描画
```

**保存は完全自動**（明示的な「保存」ボタンは無し）。○△×をクリックした瞬間、確定した瞬間、会社を追加した瞬間 — すべてGAS経由でスプシに書き込まれます。
