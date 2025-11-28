# EV Autofill Desktop (template)

Electron + Playwright で学校ごとの自動入力をまとめるテンプレートです。既存 Chrome を利用する前提です。

## セットアップ

```bash
cp .env.example .env   # CHROME_PATH を設定
npm install
npm run start          # 開発起動
```

- `CHROME_PATH` を設定するとそのパスを優先して起動します（mac の例: `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome`）。

## ビルド

```bash
npm run dist           # mac: dmg, win: nsis
```

electron-builder 設定は `package.json` の `build` セクションに含めています。

## フォルダ構成

- `main.js` … Electron メインプロセス。学校選択・PDF読込・Playwright 起動。
- `preload.js` … IPC ブリッジ。
- `renderer/` … UI (`index.html`, `renderer.js`)。
- `automations/` … 学校ごとのシナリオ (`schoolA.js`, `schoolB.js` をサンプル)。
- `.env.example` … 環境変数テンプレート。

## シナリオ追加

1. `automations/schoolX.js` を作成し、`module.exports.run = async ({ page, pdfText, ... }) => {}` を実装。
2. `main.js` の `automations` と `SCHOOL_OPTIONS` に学校 ID を追加。

> 認証情報をコードに直接記述する場合、`.env` への設定は不要です（`automations/` 内で直接値を参照してください）。

## PDF 入力

- 画面左で学校を選択し、PDF をドラッグ&ドロップまたは「ファイルを選択」ボタンで指定。
- 「自動入力を開始」ボタンを押すと PDF テキストを抽出して Playwright を実行します。

## 既存 Chrome を使う理由

`playwright-core` のみを依存にし、ブラウザ実体を同梱せずサイズを抑えています。Chrome が見つからない場合は `CHROME_PATH` を指定してください。

## 並行実行

- 共有Chrome上でコンテキストを分けて複数ジョブを同時に実行できます。
- UI 左側でジョブを開始するとジョブIDが付き、右側でジョブごとにログを切替表示できます。
- 停止ボタンでジョブ単位のコンテキストを閉じます（ブラウザ本体は共有）。
