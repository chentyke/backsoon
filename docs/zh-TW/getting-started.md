# 快速開始

[README](../../README.zh-TW.md) / 快速開始 / [English](../getting-started.md)

## 快速開始

需要 macOS 或 Linux，以及附有 npm 的 Node.js 22 或更新版本。不必全域安裝，也不必連接聊天，直接從 npm 執行以下指令試用。

```sh
task=$(npx --yes backsoon start --notify off --no-panel -- sh -c 'echo Starting; sleep 3; echo Done')
npx --yes backsoon panel --task "$task"
```

開啟顯示的網址，約三秒後任務會顯示「已完成」。點開任務，詳情視窗會從那一列展開，顯示兩行輸出。

## 安裝

```sh
npm i -g backsoon
backsoon setup
```

也可以直接從 backsoon.dev 安裝並設定。

```sh
npm i -g https://backsoon.dev/backsoon.tgz && backsoon setup
```

安裝時輸入 `y` 會將規則加入 `~/.codex/AGENTS.md`（或 `$CODEX_HOME/AGENTS.md`）。直接按 Enter 只安裝技能。要略過詢問並加入規則，請執行 `backsoon setup --yes`。若要移除規則，請刪除 BackSoon 註解標記的整段內容。

第二行指令會向 Codex 註冊技能。若要在聊天中接收通知，請用 `codex queue --help` 確認支援 `--resume`，再開啟新的聊天並輸入「用 BackSoon 執行 sleep 3，結束後通知我」。只在終端機查看結果時，可使用 `--notify off`。

## 語言設定

面板預設使用瀏覽器偏好的語言。你可以用頁首選單切換，選擇會儲存在目前的瀏覽器。終端機和聊天通知會讀取系統語言，也能用下面的指令指定繁體中文。

```sh
BACKSOON_LANG=zh-TW backsoon --help
```

## 其他用法

執行 `backsoon list` 查看任務，用 `backsoon logs ID` 查看輸出，或用 `backsoon stop ID` 停止任務。進度指令碼與通知設定請參閱[英文使用手冊](../usage.md)與[進度說明](../progress.md)，參與開發及執行測試的方法請參閱[貢獻指南](../../CONTRIBUTING.md)。
