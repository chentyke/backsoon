# はじめに

[README](../../README.ja.md) / はじめに / [English](../getting-started.md)

## 試してみる

macOS または Linux と Node.js 22 以降（npm 同梱）が必要です。グローバルにインストールせず、チャットにもつながずに、npm から直接試せます。

```sh
task=$(npx --yes backsoon start --notify off --no-panel -- sh -c 'echo Starting; sleep 3; echo Done')
npx --yes backsoon panel --task "$task"
```

表示された URL を開きます。約3秒でタスクが「完了」になり、タスクを選ぶと、その行から詳細ウィンドウが開いて出力を確認できます。

## インストール

```sh
npm i -g backsoon
backsoon setup
```

backsoon.dev から直接インストールする場合はこちらを使います。

```sh
npm i -g https://backsoon.dev/backsoon.tgz && backsoon setup
```

setup はスキルをインストールし、`hooks.json` に完了通知を登録します。`~/.codex/AGENTS.md`（または `$CODEX_HOME/AGENTS.md`）の BackSoon のルールはおすすめですが必須ではありません。追加すると、Codex が時間のかかるコマンドを自分から BackSoon に任せます。ガイドでは内容を確認してから追加でき、ブラウザーがない環境では setup がターミナルで確認します。非対話環境ではこのファイルを変更しません。`--rules` で追加、`--no-rules` で削除できます。追加後に再実行するとルールは最新に保たれ、他の記述は保持されます。スキルだけをインストールするには `backsoon setup --skill-only` を使います。続いて「BackSoon completion notices」という名前の 4 つのフックを許可します。Codex アプリでは **設定 › フック** を開き、それぞれ **信頼する** を選びます。確認が必要なのが BackSoon だけなら **すべて信頼する** を選べます。Codex CLI では `/hooks` を入力し、イベント一覧で `t` を押すと 4 件をまとめて許可できます。ほかにも確認待ちのフックがある場合は、個別に確認してください。

2行目は Codex にスキルを登録します。チャットに通知するには、`codex queue --help` で `--resume` が使えることを確認し、新しいチャットで「BackSoon で sleep 3 を実行して、終わったら知らせて」と依頼してください。端末だけで使うときは `--notify off` を指定します。

## 言語の設定

パネルはブラウザーの言語設定に従います。ヘッダーの言語メニューで変更すると、そのブラウザーに選択が保存されます。端末と通知にはシステムの言語が使われます。日本語を指定するには次のように実行します。

```sh
BACKSOON_LANG=ja backsoon --help
```

## 詳しい使い方

`backsoon list` でタスク一覧、`backsoon logs ID` で出力を確認し、`backsoon stop ID` で停止できます。進捗スクリプトや通知の設定は英語の[使い方](../usage.md)と[進捗とアラート](../progress.md)、テストの実行方法は[開発への参加](../../CONTRIBUTING.md)を参照してください。
