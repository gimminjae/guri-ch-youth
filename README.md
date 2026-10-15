# 구리교회 청년회 기도 나눔

누구나 기도부탁을 조회하고 인증한 교회 구성원이 작성하며, 관리자가 입력 필드와 그룹화·필터링을 설정하는 Next.js 앱입니다.

- 공개 목록·상세·첨부파일 조회, 상단 참여 모달의 구성원·부관리자·관리자 인증과 서버 권한 검사
- 짧은 텍스트·글을 구분한 10가지 동적 필드, 기도부탁 작성·조회·수정·삭제
- 목록 표시로 선택한 전체 필드를 반영하는 표형 목록, 관리자 순서·선택지 색상·집계 설정
- 관리자 필드 미사용·다시 사용, 기존 값 보존 및 미사용 필드 영구 삭제
- 상단 그룹 보기·복합 필터, 전체 필터 결과의 값별·그룹별 건수와 서버 페이지 조회
- 엑셀 다운로드·작성 양식, 관리자·부관리자의 열 매핑·미리보기·일괄 업로드
- URL·publishable key만 사용하는 서버 전용 Supabase RPC·AWS S3 모듈
- 공통 UI·SVG 아이콘·CSS Modules, 선택한 전체 열을 한 행에 맞추는 모바일·PC 목록과 긴 값 말줄임
- 이미지 타입 선택, 업로드 미리보기, 목록 썸네일과 상세 이미지 보기

실행·환경변수·DB 초기화·S3 설정은 [설정 안내](docs/setup.md)를 확인하세요. 요구사항과 설계는 [기존 계획](plan/plan1.md)과 [개선 계획](plan/plan2.md)에 있습니다.

기존 DB에는 **RPC 버전 5 마이그레이션 적용**이 필요합니다. [업데이트 절차](docs/setup.md#필드-미사용삭제-업데이트-rpc-버전-5)를 먼저 진행하세요. 엑셀 사용법과 제한은 [엑셀 안내](docs/excel.md)에 있습니다.

비밀번호 테이블이 비어 있으면 `.env`의 세 초기 비밀번호를 설정하고 `npm run db:seed`로 생성한 SQL을 SQL Editor에서 실행하세요.

자동 검사·브라우저 확인 결과와 실제 연결 후 확인할 항목은 [검증 기록](docs/verification.md)에 정리했습니다.

## 코드 구조

| 경로 | 역할 |
| --- | --- |
| `app/api/[...path]/route.ts` | 서버 API 진입점 |
| `lib/server/database.ts` | URL·publishable key 기반 REST RPC 연결 |
| `lib/server/storage/s3.ts` | AWS S3 전용 어댑터 |
| `lib/server/auth.ts` | 세션 쿠키와 역할 검사 |
| `lib/server/repository.ts` | 저장·조회 RPC 호출 |
| `lib/server/files.ts` | 첨부파일 소유권·연결·정리 |
| `lib/server/excel` | 서버 전용 XLSX 생성·제한된 분석 작업·열 매핑·미리보기 |
| `lib/domain.ts` | 공유 타입·입력 규칙 |
| `components/ui` | 공통 버튼·입력·모달과 CSS Modules |
| `components/prayer` | 기도부탁 화면과 전용 CSS Modules |
| `supabase/migrations` | DB 스키마·세션·권한·입력 검증·그룹화 RPC |
| `scripts/prepare-database.ts` | 최초 SQL Editor 설치 파일 생성 |
| `tests` | 타입별 검증과 PostgreSQL/API 통합 테스트 |

```sh
npm run check
```

`.env` 또는 `.env.local`에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`를 설정합니다. 최초에 `npm run db:prepare`로 생성한 SQL을 Supabase SQL Editor에서 실행한 후 `npm run db:check`로 연결을 확인합니다. DB 접속 비밀번호와 secret/service-role key는 사용하지 않습니다. 이미지·파일에는 AWS 환경변수가 별도로 필요합니다.
