# 시작하기

[README](../../README.ko.md) / 시작하기 / [English](../getting-started.md)

## 시작하기

macOS 또는 Linux와 Node.js 22 이상이 필요합니다. npm은 Node.js에 포함되어 있습니다. 전역으로 설치하거나 채팅을 연결하지 않고 npm에서 바로 실행해 볼 수 있습니다.

```sh
task=$(npx --yes backsoon start --notify off --no-panel -- sh -c 'echo Starting; sleep 3; echo Done')
npx --yes backsoon panel --task "$task"
```

표시된 URL을 여세요. 약 3초 뒤 작업이 ‘완료’로 바뀝니다. 작업을 선택하면 그 행에서 상세 창이 열리고 두 줄의 출력을 볼 수 있습니다.

## 설치

```sh
npm i -g backsoon
backsoon setup
```

backsoon.dev에서 직접 설치하려면 다음 명령을 사용하세요.

```sh
npm i -g https://backsoon.dev/backsoon.tgz && backsoon setup
```

setup은 스킬을 설치하고 `hooks.json`에 완료 알림을 등록합니다. `~/.codex/AGENTS.md`(또는 `$CODEX_HOME/AGENTS.md`)의 BackSoon 규칙은 권장 사항이며 필수는 아닙니다. 추가하면 Codex가 오래 걸리는 명령을 알아서 BackSoon에 맡깁니다. 설정 안내에서 내용을 확인한 뒤 추가할 수 있고, 브라우저가 없으면 setup이 터미널에서 묻습니다. 비대화형 설치에서는 이 파일을 바꾸지 않습니다. `--rules`로 추가하고 `--no-rules`로 제거할 수 있습니다. 추가한 뒤 다시 실행하면 규칙이 최신으로 유지되고 다른 내용은 보존됩니다. 스킬만 설치하려면 `backsoon setup --skill-only`를 사용하세요. 이어서 “BackSoon completion notices”라는 이름의 훅 네 개를 승인합니다. Codex 앱에서는 **설정 › Hook**을 열고 각각 **신뢰**를 선택하세요. BackSoon만 검토하면 되는 경우 **모두 신뢰**를 선택할 수 있습니다. Codex CLI에서는 `/hooks`를 입력하고 이벤트 목록에서 `t`를 누르면 네 개를 한 번에 승인합니다. 검토할 다른 훅이 있으면 하나씩 검토하세요.

두 번째 명령은 Codex에서 스킬을 사용할 수 있도록 등록합니다. 채팅 알림을 받으려면 `codex queue --help`에서 `--resume` 지원 여부를 확인하세요. 새 채팅에서 “BackSoon으로 sleep 3을 실행하고 끝나면 알려줘”라고 요청하면 됩니다. 터미널에서만 사용하려면 `--notify off`를 지정하세요.

## 언어 설정

패널은 브라우저의 언어 설정을 따릅니다. 상단 언어 메뉴에서 선택한 언어는 해당 브라우저에 저장됩니다. 터미널과 채팅 알림은 시스템 언어를 사용합니다. 한국어로 지정하려면 다음과 같이 실행하세요.

```sh
BACKSOON_LANG=ko backsoon --help
```

## 더 알아보기

`backsoon list`로 작업 목록을 보고 `backsoon logs ID`로 출력을 확인하세요. `backsoon stop ID`로 작업을 중지할 수 있습니다. 진행 상황 스크립트와 알림 설정은 영문 [사용 설명서](../usage.md)와 [진행 상황 안내](../progress.md), 테스트 실행 방법은 [기여 가이드](../../CONTRIBUTING.md)를 참고하세요.
