# tell

`tell "..."` とすると、Codex app-server 経由で1ターンだけ非対話実行する CLI。
モデルは `gpt-6.1-sol`、reasoning effort は `low`、service tier は `priority` (Fast) に固定。

出力にフェンス付きコードブロック (```` ``` ````) が含まれていれば、自動で `pbcopy` する。

## Install

```bash
mise use github:HikaruEgashira/tell
```

## Usage

```bash
tell "このリポジトリの構成を1行で説明して"
tell version
```

## How it works

`codex app-server` を stdio で起動し、`initialize` → `thread/start` → `turn/start` を送り、
`item/agentMessage/delta` をそのまま stdout に流す。`turn/completed` で終了する。

- スレッドは `ephemeral`、`approvalPolicy` は `never`。非対話なので承認待ちで止まらない。
- 環境変数による設定は無い。挙動を変えたいときは `index.ts` の定数を書き換える。

## License

MIT
