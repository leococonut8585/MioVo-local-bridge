# MioVo Local Bridge Server

ローカル環境でVOICEVOX/RVCサービスと通信するためのブリッジサーバーです。

## セットアップ

### 1. 必要な環境

- Node.js 18以上
- VOICEVOX Engine (ポート50021)
- RVC Server (ポート10102) - オプション

### 2. インストール

```bash
cd local-bridge
npm install
```

### 3. 起動方法

```bash
# 通常起動
npm start

# 開発モード（ファイル変更時に自動再起動）
npm run dev
```

デフォルトではポート8765で起動します。

### 4. 環境変数（オプション）

`.env`ファイルを作成して設定をカスタマイズできます：

```env
PORT=8765
VOICEVOX_URL=http://localhost:50021
RVC_URL=http://localhost:10102
```

## 使い方

1. **VOICEVOXを起動**
   ```bash
   # Dockerを使用する場合
   docker run -d -p 50021:50021 voicevox/voicevox_engine:cpu-ubuntu20.04-latest
   ```

2. **ブリッジサーバーを起動**
   ```bash
   cd local-bridge
   npm start
   ```

3. **Webアプリケーションから接続**
   - WebアプリがWebSocketで`ws://localhost:8765`に自動接続します
   - 接続状態はUIに表示されます

## 機能

- ✅ VOICEVOX音声合成プロキシ
- ✅ RVC音声変換プロキシ
- ✅ ファイルアップロード処理
- ✅ モデル学習管理
- ✅ サービス状態監視
- ✅ WebSocketリアルタイム通信

## トラブルシューティング

### VOICEVOXに接続できない場合

1. VOICEVOXが起動しているか確認
2. ポート50021が開いているか確認
3. ファイアウォール設定を確認

### WebSocketに接続できない場合

1. ブリッジサーバーが起動しているか確認
2. ポート8765が使用されていないか確認
3. ブラウザのコンソールでエラーを確認

## セキュリティ注意事項

⚠️ このサーバーはローカル環境での使用を想定しています。
インターネットに公開する場合は、適切な認証機構を実装してください。