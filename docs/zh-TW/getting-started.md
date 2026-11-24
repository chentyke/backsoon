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

setup 會安裝技能，並在 `hooks.json` 註冊任務完成通知。`~/.codex/AGENTS.md`（設定了 `CODEX_HOME` 時為該目錄）中的 BackSoon 規則是推薦項而非必選：加入後，Codex 會主動把耗時指令交給 BackSoon。安裝指南會先展示規則內容，你確認後才寫入；沒有瀏覽器時 setup 會在終端機詢問，非互動安裝不會修改這個檔案。用 `--rules` 加入規則，用 `--no-rules` 移除。加入後重跑 setup 會保持規則為最新，並保留檔案中的其他內容。只安裝技能請用 `backsoon setup --skill-only`。然後信任名為「BackSoon completion notices」的四個 hook：在 Codex 桌面版開啟 **設定 › 掛勾**，逐一點按 **信任**；如果只有 BackSoon 需要審核，可點按 **全部信任**。在 Codex 命令列輸入 `/hooks`，在事件列表按 `t` 可一次信任全部四項。如果還有其他待審核的 hook，請逐一審核。

第二行指令會向 Codex 註冊技能。若要在聊天中接收通知，請用 `codex queue --help` 確認支援 `--resume`，再開啟新的聊天並輸入「用 BackSoon 執行 sleep 3，結束後通知我」。只在終端機查看結果時，可使用 `--notify off`。

## 語言設定

面板預設使用瀏覽器偏好的語言。你可以用頁首選單切換，選擇會儲存在目前的瀏覽器。終端機和聊天通知會讀取系統語言，也能用下面的指令指定繁體中文。

```sh
BACKSOON_LANG=zh-TW backsoon --help
```

## 其他用法

執行 `backsoon list` 查看任務，用 `backsoon logs ID` 查看輸出，或用 `backsoon stop ID` 停止任務。進度指令碼與通知設定請參閱[英文使用手冊](../usage.md)與[進度說明](../progress.md)，參與開發及執行測試的方法請參閱[貢獻指南](../../CONTRIBUTING.md)。
