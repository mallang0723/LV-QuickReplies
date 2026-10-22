# ST Quick Replies (Lumiverse 확장)

SillyTavern의 Quick Reply(QR) 내보내기 파일(`.json`)을 [Lumiverse](https://lumiverse.chat/)에 가져와, 입력창 위 버튼으로 실행하는 Spindle 확장입니다. QR 안의 STscript(`/input`, `/gen`, `/sendas` …)를 Lumiverse API로 다시 구현해 실행합니다.

## 설치

1. Lumiverse → 서랍(drawer) → **Extensions** → **Add Extension**
2. *Install from Source*에 `https://github.com/mallang0723/LV-QuickReplies` 입력 → **Install**
3. 설치된 확장의 **Enable**을 켜고, 권한 두 개를 허용합니다.
   - `generation`: `/gen`, `/genraw`, `/trigger`, 일반 문장 QR 전송
   - `chat_mutation`: `/sendas`, `/sys`, `/comment`, `/send`로 채팅에 메시지 추가

## 사용법

- 서랍의 **QR** 탭(번개 아이콘)에서 **SillyTavern QR 가져오기 (.json)**를 누르고 파일을 고릅니다. 여러 파일을 한 번에 고를 수 있습니다.
  - **세트 내보내기 파일**(`qrList`가 있는 파일)은 세트 하나가 됩니다.
  - **QR 하나짜리 내보내기 파일**은 `가져온 QR` 세트에 모입니다.
- 채팅 화면의 입력창 바로 위에 버튼 줄이 생깁니다. 누르면 실행됩니다.
- 실행 중에는 **■ 중지** 버튼이 나타납니다. `/gen` 생성 도중에도 멈출 수 있습니다.
- 입력창의 추가 메뉴(Extras)에 있는 **Quick Replies 관리**를 누르면 QR 탭이 열립니다.
- QR 탭에서 세트를 켜고 끄거나, 이름을 바꾸거나, QR을 새로 만들고 편집·삭제할 수 있습니다. 세트를 끄면 버튼 줄에서 사라집니다.

## 지원하는 STscript

| 명령어 | 동작 |
|---|---|
| `/input 질문` | 입력 창을 띄우고, 입력한 값을 다음 명령어로 넘김. 취소하면 빈 값 |
| `/setvar key=이름 값`, `/getvar`, `/addvar`, `/incvar`, `/decvar`, `/flushvar` | 채팅별 변수. Lumiverse의 `{{getvar::이름}}`과 같은 저장소를 씀 |
| `/setglobalvar` 등 `…globalvar` | 모든 채팅에서 공유하는 변수 |
| `/if left= right= rule= {: … :}` (`else=`) | 조건 실행. rule: `eq` `neq` `lt` `gt` `lte` `gte` `not` `in` `nin` |
| `/abort` | 실행 중단. `quiet=false`면 이유를 알림으로 띄움 |
| `/echo 문장` | 알림(toast). `severity=info/success/warning/error` |
| `/gen 지시문` | 현재 채팅의 프롬프트(캐릭터·대화 기록·월드인포·프리셋)에 지시문을 덧붙여 생성하고, 결과를 다음 명령어로 넘김 |
| `/genraw 지시문` | 지시문만 보내 생성 |
| `/sendas name=… 내용` | 캐릭터 메시지로 추가 (화면에는 현재 채팅의 캐릭터 이름으로 표시) |
| `/sys 내용` | 시스템 메시지로 추가 (AI에게도 보임) |
| `/comment 내용` | 시스템 메시지로 추가하고 숨김 처리 (AI 프롬프트에서 빠짐) |
| `/send 내용` | 사용자 메시지로 추가 (답변 생성 없음) |
| `/trigger` | 답변 생성 시작 (입력창이 비어 있을 때만) |
| `/setinput 내용` | 입력창 내용을 바꿈 |
| `/run 이름` 또는 `/:이름` | 다른 QR 실행 (`세트이름.QR이름`도 가능) |
| `/pass`, `/return`, `/trim`, `/len`, `/delay` | 보조 명령어 |
| `//`, `/#` | 주석 |

- 명령어 구분 `|`, 자동 전달 끊기 `||`, `{{pipe}}`, 클로저 `{: … :}`, 따옴표 인자, `\|` 이스케이프를 SillyTavern 파서 규칙대로 처리합니다.
- `{{char}}`, `{{user}}`, `{{getvar::…}}` 같은 매크로는 각 명령어를 실행하는 시점에 Lumiverse 매크로 엔진으로 풀립니다.
- `/`로 시작하지 않는 QR은 일반 문장으로 보고, 입력창에 넣어 전송합니다. 세트 설정의 `disableSend`(자동 전송 끔), `injectInput`/`placeBeforeInput`(입력창 글 앞뒤에 붙이기)를 따릅니다.
- 위 표에 없는 명령어가 하나라도 있으면 **아무것도 실행하지 않고** 어떤 명령어가 지원되지 않는지 알려 줍니다.

## SillyTavern과 다른 점

- `/gen`의 지시문은 기본적으로 프롬프트 끝에 **system** 역할로 붙습니다(SillyTavern 기본값과 같음). 쓰는 모델이 중간의 system 메시지를 잘 처리하지 못하면 QR 탭에서 **/gen 지시문 역할**을 `user`로 바꾸세요.
- `/sendas name=`의 이름은 쓰이지 않습니다. Lumiverse 확장 API에는 메시지 이름을 지정하는 기능이 없고, 확장이 추가한 캐릭터 메시지의 저장 이름은 `Assistant`로 고정됩니다. 화면에는 현재 채팅의 캐릭터 이름으로 표시됩니다.
- `{{getvar::}}`, `{{getglobalvar::}}`, `{{var::}}`는 확장이 직접 풉니다. Lumiverse 매크로 엔진은 매번 빈 변수 상태에서 시작해서 `/setvar` 값을 읽지 못하기 때문입니다. 나머지 매크로는 Lumiverse가 풉니다.
- 입력창 연동(일반 문장 QR, `/setinput`, `/trigger`): Lumiverse에 입력창 API(`ctx.composer`, composer-v1)가 있으면 그것을 쓰고, 없으면 입력창(`textarea[name="chat-message"]`)과 전송 버튼을 직접 조작합니다. 현재 Lumiverse main(1.2.5)에는 이 API가 없어 직접 조작 방식으로 동작하므로, Lumiverse 화면 구조가 바뀌면 이 세 기능이 깨질 수 있습니다.
- QR 자동 실행 옵션(`executeOnUser`, `executeOnAi`, `executeOnChatChange` 등)과 컨텍스트 메뉴(`contextList`)는 아직 지원하지 않습니다. 가져올 때 무시됩니다.
- FontAwesome 아이콘(`icon`)은 표시하지 않고, 버튼에는 항상 이름(label)을 씁니다.
- QR 하나가 실행 중일 때는 다른 QR을 실행할 수 없습니다.

## 검증 기록

- 자동 테스트(`bun test`): 파서·런타임·가져오기 23개. 직접 만든 샘플 QR 두 개(`tests/fixtures/`, `/gen` → `/sendas`와 `/gen` → `/comment`)로 입력·취소 흐름을 검증합니다.
- 실제 Lumiverse(main `98b2e95`, 1.2.5)를 로컬에서 띄우고, 가짜 OpenAI 호환 서버를 연결해 브라우저로 확인한 항목:
  - Import Local 설치와 권한 허용 후 확장 시작. 설치 시 코드 검사기에서 차단 항목 0건
  - QR 탭 열기(Extras 메뉴), `.json` 두 개 가져오기, 입력창 위 버튼 표시
  - `/input` → `/if` → `/gen` → `/sendas` QR: 주제 입력 → `/gen` 요청이 캐릭터 설명이 포함된 전체 프롬프트 + 끝의 system 지시문(주제·`{{char}}` 반영)으로 감 → 결과가 캐릭터 메시지로 추가됨
  - `/input` → `/if` → `/gen` → `/comment` QR: 취소 시 `/echo` 알림만 뜨고 AI 호출 없음 / 주제 입력 시 결과가 숨김 코멘트로 추가되고, 다음 일반 답변 프롬프트에서 빠짐
  - 일반 문장 QR 전송, `/setinput`, `/send` + `/trigger`
- 확인하지 못한 것: 실제 AI 모델 응답, ■ 중지 버튼으로 생성 도중 멈추기(자동 테스트로만 확인), 모바일 화면, Lumiverse staging 브랜치

## 개발

```bash
bun install
bun test          # 파서·런타임·가져오기 테스트
bun run typecheck
bun run build     # dist/backend.js, dist/frontend.js 생성 — 변경 후 dist도 함께 커밋
```

구조:

- `src/stscript/parser.ts` — STscript 파서
- `src/stscript/runtime.ts` — 명령어 실행기 (Lumiverse 의존 없음, `Host` 인터페이스로 주입)
- `src/qr-import.ts` — SillyTavern QR JSON → 내부 형식
- `src/backend.ts` — 저장(사용자별), 실행, Lumiverse API 연결
- `src/frontend.ts` — 입력창 위 버튼 줄, QR 탭, 입력창 연동
