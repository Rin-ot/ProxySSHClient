# ProxySSHClient

プロキシ環境下（HTTP CONNECT / SOCKS4 / SOCKS5）でも動作する、ポータブルなデスクトップ向けSSHクライアントです。

## 特徴

* **各種プロキシ対応**: HTTP CONNECT トンネルのほか、SOCKS4 / SOCKS5 プロキシに対応。
* **ローカルDNS解決**: プロキシを使用する際も、ローカルマシンの `hosts` ファイル（`C:\Windows\System32\drivers\etc\hosts` 等）に定義された仮想ホスト名を優先して解決可能。
* **マルチタブUI**: 複数のSSH接続セッションをタブで切り替えて同時に操作できます。
* **ローカル完結**: 保存した接続情報はブラウザ（Electron）の `localStorage` にのみ保存され、外部サーバーには送信されません。
* **ポータブル実行ファイル**: Node.js等のインストールなしで、ダブルクリックするだけで起動できます。

## 構成

* **フロントエンド**: React + xterm.js (Viteによる高速ビルド)
* **バックエンド**: Node.js (Express, ws, ssh2, socks)
* **デスクトップラッパー**: Electron

---

## 開発とビルド

### 開発環境のセットアップ

```bash
# 依存パッケージのインストール
npm install
```

### 開発モードでの起動

```bash
# Viteの開発サーバーとElectronを起動します
npm start
```

### スタンドアロン実行ファイル（.exe）のビルド

Windows向けのポータブル実行ファイルを生成します。

```bash
# ビルドを実行
npm run dist
```

ビルド完了後、`dist-desktop-build/` ディレクトリ内に `ProxySSHClient 0.0.0.exe` が生成されます。

## ライセンス

MIT
