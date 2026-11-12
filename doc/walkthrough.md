# 나만의패스워드관리 - UI/UX 개편 및 로컬 서버 라이프사이클 자동화 개발 보고서

본 문서는 **나만의패스워드관리(안전한계정관리)** 패스워드 매니저 프로그램의 화면 구조 최적화 및 로컬 백그라운드 구동 편의성을 비약적으로 향상시키기 위해 진행된 UI/UX 개편과 서버 자동화 개발 내역을 상세하게 기록한 문서입니다.

---

## 📌 주요 개발 내용 요약

### 1. 화면 공간 100% 활용을 위한 좌측 사이드바 제거 및 상단 카테고리 풀다운 메뉴 도입
* **배경**: 기존 좌측의 고정형 카테고리 메뉴가 화면 영역을 과도하게 차지하여 계정 카드가 배치될 메인 영역이 좁게 느껴지는 한계가 있었습니다.
* **개선**: 
  * 기존 좌측 사이드바(`aside.app-sidebar`)를 완전히 제거하여 화면을 넓고 시원하게 쓰는 **풀-와이드 프리미엄 레이아웃**을 완성했습니다.
  * 기존 사이드바의 카테고리 탐색 기능을 화면 우측 상단(**비활동 시... 자동 잠김 표시기**의 왼쪽)에 **글래스모피즘(Glassmorphism) 기반 프리미엄 풀다운 메뉴** 형태로 세련되게 변형하여 이식했습니다.
  * 카테고리 드롭다운 항목 선택 시 버튼의 **아이콘, 카테고리명, 실시간 개수 배지**가 즉각 해당 정보로 교체 및 갱신되도록 하였습니다.

### 2. 거추장스러운 검은색 CMD 창 방해 없는 백그라운드 무음 실행 기법 도입
* **배경**: 이전 방식은 로컬 백엔드 서버(Node.js)를 기동하기 위해 검은색 CMD 콘솔 창을 항시 띄워두고 유지해야만 하여 작업 표시줄이 번잡해지고 사용자 경험이 훼손되었습니다.
* **개선**:
  * CMD 터미널 창을 표출하지 않고 윈도우 백그라운드 프로세스로 로컬 서버를 구동해 주는 VBScript 파일([run_hidden.vbs](file:///d:/Pass_manage/run_hidden.vbs))을 작성했습니다.
  * 이 스크립트를 더블클릭하면 윈도우 바탕에서 숨겨진 채 서버만 무음 가동되고 브라우저 화면이 바로 열리게 됩니다.

### 3. 브라우저 종료 감지 시 서버 프로세스 자동 소멸 시스템 (Heartbeat) 구축
* **배경**: 백그라운드로 실행할 경우 서버가 조용히 켜지지만 사용 후 웹 브라우저를 꺼도 백그라운드에서 동작 중인 `node.exe` 서버는 계속 살아 있어, 리소스를 낭비하지 않고 서버를 완전히 끄려면 비상용 `stop_server.bat`를 번거롭게 수동으로 눌러 종료해야 하는 애로사항이 생겼습니다.
* **개선**:
  * **하트비트(생존 신호) 메커니즘**을 전격 고안 및 빌드했습니다.
  * 브라우저 웹앱(`app.js`)이 켜져 있는 동안 주기적으로 서버(`server.js`)에 가벼운 HTTP 생존 신호를 송신하며, 브라우저 창이나 탭이 닫혀 신호가 **7초 이상 끊기면** 서버 프로세스가 스스로 인지하여 즉각 안전하게 전원을 내리도록(`process.exit(0)`) 라이프사이클을 설계했습니다.

---

## 🛠️ 수정 및 신규 생성 파일 목록

| 변경 구분 | 파일명 | 파일 절대 경로 | 주요 변경 내용 |
| :---: | :--- | :--- | :--- |
| **MODIFY** | [index.html](file:///d:/Pass_manage/index.html) | `d:\Pass_manage\index.html` | 사이드바 컴포넌트(`aside`) 제거 및 우측 상단 카테고리 드롭다운 HTML 탑재 |
| **MODIFY** | [app.js](file:///d:/Pass_manage/app.js) | `d:\Pass_manage\app.js` | 드롭다운 여닫기/선택 이벤트 추가, 생존 신호 전송(`startHeartbeatSystem`) 및 수량 배지 동기화 처리 |
| **MODIFY** | [styles.css](file:///d:/Pass_manage/styles.css) | `d:\Pass_manage\styles.css` | 드롭다운 글래스모피즘 전용 스타일링, 호버 및 드롭 애니메이션, 플렉스 반응형 배열 조정 |
| **MODIFY** | [style_v2.css](file:///d:/Pass_manage/style_v2.css) | `d:\Pass_manage\style_v2.css` | 대체 스타일시트 파일에도 동일한 카테고리 및 레이아웃 CSS 동기화 반영 |
| **MODIFY** | [server.js](file:///d:/Pass_manage/server.js) | `d:\Pass_manage\server.js` | `/api/heartbeat` 수신 엔드포인트 개설, 7초 무활동 타임아웃 프로세스 소멸자 장착 |
| **NEW** | [run_hidden.vbs](file:///d:/Pass_manage/run_hidden.vbs) | `d:\Pass_manage\run_hidden.vbs` | CMD 콘솔 창을 아예 숨긴 채 Node 서버와 기본 브라우저를 간결히 구동해주는 실행기 |
| **NEW** | [stop_server.bat](file:///d:/Pass_manage/stop_server.bat) | `d:\Pass_manage\stop_server.bat` | 예기치 못한 교착 상태나 수동 기동 시 Node 프로세스를 강제로 안전하게 Kill 해주는 안전장치 |

---

## 📊 서버 제어 및 라이프사이클 플로우차트

```mermaid
sequenceDiagram
    actor User as 사용자
    participant Browser as 크롬/엣지 브라우저 (app.js)
    participant Server as 로컬 보안 백엔드 (server.js)

    User->H-Server: [run_hidden.vbs] 더블클릭 (백그라운드 Node 가동)
    Server-->>-Browser: 기본 브라우저 실행 및 웹앱 연결 (http://localhost:3000)
    
    Note over Browser,Server: [웹서비스 사용 중]
    loop 2.5초 간격 상시 진행
        Browser->>Server: HTTP POST /api/heartbeat (생존 신호 전송)
        Server->>Server: lastHeartbeatTime 업데이트
    end

    User->>Browser: 패스워드 매니저 브라우저 창 닫기!
    Note over Browser: 신호 송출 정지 (브라우저 소멸)
    
    Note over Server: server.js의 타이머 가동 (3초 주기로 시간 검사)
    Server->>Server: 현재시간 - lastHeartbeatTime > 7초 초과 감지!
    Server->>User: [자동 종료] 로컬 백엔드 서버 메모리 자원 완전 해제 및 자폭 종료 (process.exit)
```

---

## 🏁 최종 적용 성과 및 기대 효과
1. **완성도 높은 디자인**: 검은색 터미널 창의 물리적 방해 요소가 100% 제거되었으며, 카테고리가 드롭다운으로 심플하게 압축되어 대시보드가 프리미엄 웹 서비스에 준하는 압도적인 첫인상(Aesthetic Wow-factor)을 전달합니다.
2. **리소스를 최소화하는 스마트 관리**: 더 이상 프로세스가 사용 중단 후 램(RAM)에 남아 좀비 백그라운드 리소스를 낭비하지 않으며 브라우저 종료 시 완벽히 정지됩니다.
3. **윈도우 최적성**: VBScript와 기본 WshShell 라이브러리를 통해 타사 유틸리티나 파이썬 등의 부가 설치 없이 Windows 기본 환경에서 무설치 가동을 완벽 보장합니다.
