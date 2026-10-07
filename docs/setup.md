# 실행 및 운영 설정

## Supabase 연결에 필요한 값

이제 DB 연결에는 아래 두 환경변수만 사용한다. `DATABASE_URL`, DB 접속 비밀번호, secret/service-role key는 필요하지 않다.

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

두 값을 프로젝트 루트 `.env` 또는 `.env.local`에 입력한다. 셸 환경변수 → `.env.local` → `.env` 순으로 우선한다. 기존 `.env`의 `DATABASE_URL`·`DATABASE_SSL`·`DATABASE_CA_CERT`·`SESSION_SECRET`·`TRUST_PROXY` 값은 더 이상 사용하지 않는다.

Supabase URL은 프로젝트 기본 URL이며 `/rest/v1`을 붙이지 않는다. 두 값은 Supabase Dashboard의 **Connect** 또는 **Settings → API Keys**에서 확인할 수 있다. [API 키 안내](https://supabase.com/docs/guides/getting-started/api-keys)

## 최초 설치

Node.js 22 이상이 필요하다. publishable key는 SQL 실행·테이블 생성 권한이 없으므로, 아래 최초 설치는 프로젝트의 **SQL Editor 접근 권한**으로 한 번 실행한다. SQL Editor 권한도 없다면 프로젝트 관리자에게 설치 SQL 실행을 요청한다.

1. `.env.example`를 참고해 `.env`를 작성한다. 기존 `.env`가 있으면 덮어쓰지 않고 필요한 값을 추가한다.
2. 최초 역할 비밀번호 세 개를 `INITIAL_MEMBER_PASSWORD`, `INITIAL_SUB_ADMIN_PASSWORD`, `INITIAL_ADMIN_PASSWORD`에 각각 설정한다. 길이와 문자 조합 규칙은 적용하지 않으며 입력한 값을 그대로 사용한다. 첨부파일 정리용 `CRON_SECRET`은 32자 이상의 무작위 값으로 설정한다.
3. 아래 명령으로 설치 SQL을 생성한다.

```sh
npm ci
npm run db:prepare
```

비밀번호 등록 없이 DB 구조와 RPC 연결만 먼저 준비하려면 `npm run db:prepare -- --schema-only`를 사용한다. 이 경우 로그인 전 세 초기 비밀번호를 설정하고 기본 명령으로 SQL을 다시 생성·적용해야 한다.

4. 생성된 `.local/supabase-setup.sql` 전체 내용을 Supabase **SQL Editor → New query**에서 실행한다. 끝에 `{"data":{"version":3}}`가 표시되면 함수 설치가 완료된 것이다.
5. 앱에서 연결을 확인하고 실행한다.

```sh
npm run db:check
npm run dev
```

`db:prepare`는 SQL 파일만 생성하며 DB에 자동으로 적용하지 않는다. 설치 SQL에는 초기 비밀번호가 포함되므로 Git에서 제외된 `.local` 안에 소유자만 읽는 파일로 저장한다. 설치 후 파일을 삭제하고 배포 환경에서 `INITIAL_*` 값을 제거해도 된다. 역할 비밀번호는 DB에서 SHA-256 전처리와 bcrypt로 해시한다.

관리자로 참여한 뒤 **필드 관리 → 필드 추가**에서 작성 항목을 만든다. 샘플 필드와 기도부탁은 실제 DB에 자동 생성하지 않는다. 첫 화면에서는 누구나 목록·상세·게시된 첨부파일을 볼 수 있다. 상단 **참여하기** 모달에서 구성원·부관리자·관리자 권한을 인증하고, 인증 후 **권한 변경**으로 다른 역할로 전환한다. 로그아웃해도 조회는 계속할 수 있다.

## 비밀번호 테이블이 비어 있을 때

`--schema-only`로 만든 SQL이나 마이그레이션만 실행하면 `prayer_private.password`의 역할별 비밀번호는 등록되지 않는다. `.env`에 `INITIAL_MEMBER_PASSWORD`, `INITIAL_SUB_ADMIN_PASSWORD`, `INITIAL_ADMIN_PASSWORD`를 설정하고 아래 명령을 실행한다. 기존 `NEXT_PUBLIC_INITIAL_*_PASSWORD` 이름도 초기화 스크립트에서 호환하지만, 새 설정은 서버 전용 이름을 사용한다. 두 이름이 모두 있으면 접두사 없는 값이 우선한다.

```sh
npm run db:seed
```

생성된 `.local/supabase-passwords.sql`을 Supabase SQL Editor에서 실행하면 비어 있는 역할만 추가한다. 이미 등록된 비밀번호는 덮어쓰지 않는다. 마지막 결과에 `admin`, `member`, `sub-admin`이 표시되는지 확인한다. 이 파일에는 초기 비밀번호가 있으므로 외부에 공유하지 않는다.

길이 제한이 있던 기존 DB는 먼저 `supabase/migrations/20261007164150_unrestricted_passwords.sql`을 SQL Editor에서 실행한다. 이 변경은 길이 제한만 제거하고 기존 비밀번호 해시·세션·로그인 시도 제한은 유지한다. 새 DB에는 최신 `db:prepare` SQL에 포함된다.

일반 `db:prepare`와 `db:seed`는 초기 비밀번호가 누락되면 오류를 표시한다. 비밀번호 없이 구조만 생성하는 경우에만 `--schema-only`를 사용한다. 명령은 SQL 파일을 생성할 뿐, 실제 DB에 자동 등록하지 않는다.

## 공개 조회 업데이트 (2026-10-08)

기존 DB에는 `supabase/migrations/20261007150623_public_prayer_read.sql`을 Supabase SQL Editor에서 실행한다. 기존 데이터와 비밀번호는 유지하며 RPC 설치 버전이 3으로 바뀐다. 이번 변경은 테이블 직접 접근 권한을 추가하지 않고, 기존 RPC의 조회 작업만 공개한다.

마이그레이션 이력도 함께 관리하려면 `npm run db:prepare -- --schema-only`로 `.local/supabase-setup.sql`을 생성하고 SQL Editor에서 실행한다. 기본 테이블 SQL만 수동 설치해 이력이 없는 DB는 `--existing-schema`도 지정한다. 적용 후 `npm run db:check`로 버전 3을 확인한다. publishable key로는 스키마 변경 SQL을 자동 적용할 수 없다.

## 이전 DB에서 전환하기

- 기존 `npm run db:migrate`로 설치했다면 `prayer_migrations.history`가 있으므로 생성된 설치 SQL이 이미 적용한 마이그레이션을 건너뛴다.
- 기존 `20261005064609_prayer_board.sql`만 SQL Editor에서 직접 실행했다면, 초기 테이블 설치 이력을 등록하는 `--existing-schema` 옵션을 사용한다.
- 이전 scrypt 비밀번호는 DB의 bcrypt 검사로 자동 변환할 수 없다. 세 `INITIAL_*_PASSWORD`를 설정하고 `--reset-passwords`로 새 비밀번호를 등록한다. 이 옵션은 세 역할의 기존 세션을 폐기한다.

```sh
# 기존 초기화 명령으로 설치한 DB
npm run db:prepare -- --reset-passwords

# 기본 SQL 파일만 수동으로 설치한 DB
npm run db:prepare -- --existing-schema --reset-passwords
```

생성된 SQL을 SQL Editor에서 실행한 뒤 `npm run db:check`를 실행한다. 기도부탁과 필드 데이터는 보존한다. 기본 설치는 기존 비밀번호를 덮어쓰지 않는다. 관리 비밀번호 분실 시에도 `--reset-passwords` 절차를 사용한다.

설치 SQL은 마이그레이션 체크섬과 이력을 기록하며 재실행해도 적용한 변경을 반복하지 않는다. 적용한 마이그레이션 파일은 수정하지 말고 후속 파일을 추가한다. 새 RPC를 SQL Editor에서 직접 설치한 경우에도 다음 생성 SQL 실행 시 이력에 등록할 수 있다.

## 환경변수

| 변수 | 용도 |
| --- | --- |
| `SUPABASE_URL` | Supabase 프로젝트 기본 URL |
| `SUPABASE_PUBLISHABLE_KEY` | Data API 호출용 공개 키 |
| `APP_ORIGIN` | 브라우저 요청 출처 검증. 운영에서는 실제 HTTPS 도메인 필수 |
| `AWS_REGION`, `S3_BUCKET` | S3 리전과 비공개 버킷 |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 접근 권한이 있는 IAM 사용자의 액세스 키와 시크릿 키 |
| `INITIAL_MEMBER_PASSWORD`, `INITIAL_SUB_ADMIN_PASSWORD`, `INITIAL_ADMIN_PASSWORD` | SQL Editor에서 최초 비밀번호 등록·복구할 때만 필요 |
| `CRON_SECRET` | 파일 정리 예약 작업 인증. 초기 설치 SQL에도 같은 값의 해시를 등록 |

DB 연결값 두 개와 교회 참여 비밀번호·S3 설정은 서로 다른 용도다. S3를 사용하는 경우 AWS 환경변수는 계속 필요하다. `NEXT_PUBLIC_` 변수는 사용하지 않는다.

## 접근 제어와 서버 모듈

브라우저 → 앱 API → `lib/server/database.ts` → Supabase의 `public.prayer_api` 순으로 호출한다. Supabase SDK를 클라이언트에 넣지 않고 서버의 기본 `fetch`로 공식 REST RPC를 호출한다. publishable key는 `apikey` 헤더에 넣으며 JWT로 취급하지 않는다. [Database Functions](https://supabase.com/docs/guides/database/functions)

- Data API에는 정해진 작업만 받는 `prayer_api` 함수 하나를 제공한다. 임의 SQL을 실행하는 함수는 없다.
- 공개 함수는 `SECURITY INVOKER`이며 권한이 필요한 구현은 비공개 스키마의 함수에 둔다. 비공개 함수는 고정된 `search_path`를 사용한다.
- 공유 비밀번호 방식은 기존 요구사항을 유지한다. Supabase Auth 사용자 JWT 대신 DB가 생성한 256비트 임의 세션 토큰으로 인증한다. 토큰 원문은 HttpOnly·SameSite 쿠키, DB에는 SHA-256 해시만 저장한다. 운영 쿠키는 Secure다.
- 인증 세션의 역할·만료·`sessionVersion`을 DB에서 매번 검사한다. 요청 본문에 `admin`을 넣거나 공개 키만 갖고 있어도 관리 작업을 수행할 수 없다.
- 기도부탁·필드 조회, 그룹화·필터링, 게시된 첨부파일 조회는 공개한다. 작성·변경·업로드에는 세션이 필요하며 미확정 파일은 업로드한 세션만 조회한다. `health`는 설치 버전만 반환하고 예약 정리에는 별도 `CRON_SECRET` 검증을 적용한다.
- 테이블 RLS와 직접 접근 차단을 유지한다. `prayer_private`를 Data API 노출 스키마에 추가하지 않는다. `anon`에는 진입 함수 실행을 위한 schema usage/execute만 주며 테이블 권한은 주지 않는다.
- 필드·기도부탁 변경과 첨부 연결은 RPC 한 번의 PostgreSQL 트랜잭션에서 처리한다. 그룹 건수와 목록은 같은 SQL 스냅샷을 사용한다.
- 실패한 로그인은 역할별 15분당 10회로 DB에서 제한하고, 성공하면 실패 누적을 초기화한다. 호출자가 IP를 바꾸거나 앱 API를 우회해도 동일하게 적용된다. 작성은 세션당 시간당 20회, 업로드는 30회다.

## AWS S3와 예약 정리

S3 연결에는 아래 네 환경변수를 설정한다. `lib/server/storage/s3.ts`가 액세스 키와 시크릿 키를 명시적으로 사용하므로 `AWS_SESSION_TOKEN`은 필요하지 않으며, 셸에 남아 있어도 사용하지 않는다. AWS 프로필이나 서버 IAM 역할에서 자격 증명을 자동으로 가져오지 않는다.

```dotenv
AWS_REGION=ap-northeast-2
S3_BUCKET=YOUR_BUCKET
AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
```

IAM 사용자의 장기 액세스 키를 사용한다. STS 임시 자격 증명은 세션 토큰이 필수이므로 이 설정 방식에서는 지원하지 않는다. [AWS 임시 자격 증명 안내](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_use-resources.html)

S3 버킷의 퍼블릭 액세스 차단을 유지한다. 앱의 업로드·다운로드는 서버를 거치므로 공개 읽기 권한과 S3 CORS 설정이 필요하지 않다. 해당 IAM 사용자에게 버킷의 `prayers/*` 경로에 대한 아래 권한을 준다.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::YOUR_BUCKET/prayers/*"
  }]
}
```

업로드는 4MB까지 허용한다. 이미지 JPG·PNG·WebP·GIF와 문서 PDF·DOCX·XLSX·PPTX를 지원하며 서버에서 실제 형식을 검사한다. DB가 고유 객체 키를 생성하므로 사용자 지정 S3 경로를 받지 않는다. 앱 브라우저 응답에는 UUID만 반환한다.

5~10분마다 `POST /api/maintenance`를 `Authorization: Bearer <CRON_SECRET>` 헤더로 호출한다. 미확정 파일은 1시간 후 정리 대상이며 S3 삭제 실패는 재시도한다. `CRON_SECRET`을 바꾸면 `db:prepare`로 SQL을 다시 생성·적용해 DB 해시도 갱신한다. 버킷 버전 관리가 켜져 있으면 비현재 버전은 별도 수명 주기 정책으로 정리한다.

## 검증과 연결 없는 미리보기

```sh
npm run check
```

자동 테스트는 실제 SQL 마이그레이션과 RPC를 PGlite에서 `anon` 역할로 호출한다. 실제 Supabase 네트워크·Data API 설정과 S3 IAM 검증을 대신하지 않는다.

클라우드 설정 없이 화면을 확인하려면 별도 터미널 두 개에서 실행한다.

```sh
# 터미널 1
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000

# 터미널 2
node --conditions=react-server --import tsx scripts/preview.ts
```

`http://localhost:3100`에 접속한다. 테스트 전용 비밀번호는 `tests/helpers.ts`의 `TEST_PASSWORDS`에 있다. 미리보기는 메모리 DB와 파일만 사용하고 종료 시 사라진다.

| 역할 | 허용 작업 |
| --- | --- |
| 비인증 | 목록·상세·그룹화·필터링·게시된 첨부파일 조회, 설치 버전 확인 |
| `member` | 기도부탁 작성·조회·그룹화·필터링·첨부파일 조회 |
| `sub-admin` | 구성원 권한과 모든 기도부탁 수정·삭제 |
| `admin` | 모든 기능, 필드·그룹화·필터링 설정, 역할별 비밀번호 변경 |

개인 계정·가입 승인·개인별 작성자 확인은 구현 범위에 포함하지 않는다.
