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

설치 중 `y`를 입력하면 `~/.codex/AGENTS.md`(또는 `$CODEX_HOME/AGENTS.md`)에 규칙이 추가됩니다. Enter만 누르면 스킬만 설치합니다. 확인 없이 규칙도 추가하려면 `backsoon setup --yes`를 실행하세요. 규칙을 삭제하려면 BackSoon 주석으로 표시된 부분을 주석과 함께 지우세요.

두 번째 명령은 Codex에서 스킬을 사용할 수 있도록 등록합니다. 채팅 알림을 받으려면 `codex queue --help`에서 `--resume` 지원 여부를 확인하세요. 새 채팅에서 “BackSoon으로 sleep 3을 실행하고 끝나면 알려줘”라고 요청하면 됩니다. 터미널에서만 사용하려면 `--notify off`를 지정하세요.

## 언어 설정

패널은 브라우저의 언어 설정을 따릅니다. 상단 언어 메뉴에서 선택한 언어는 해당 브라우저에 저장됩니다. 터미널과 채팅 알림은 시스템 언어를 사용합니다. 한국어로 지정하려면 다음과 같이 실행하세요.

```sh
BACKSOON_LANG=ko backsoon --help
```

## 더 알아보기

`backsoon list`로 작업 목록을 보고 `backsoon logs ID`로 출력을 확인하세요. `backsoon stop ID`로 작업을 중지할 수 있습니다. 진행 상황 스크립트와 알림 설정은 영문 [사용 설명서](../usage.md)와 [진행 상황 안내](../progress.md), 테스트 실행 방법은 [기여 가이드](../../CONTRIBUTING.md)를 참고하세요.
