# 구리교회 청년회 프로젝트

## 기능 1

첫번째 기능은 기도부탁 기능이다.

내가 생각한 DB 테이블 정보
praycontent
- id: uuid
- content: json
- listdisplaydata: string[]
- createDateTime
- updateDateTime

praycontentfield
- id: uuid
- name: string
- datatype: string (selectbox, selectmultibox, checkbox, string, number, date, image, file, bool)
- displaytype: string[] (badge, bold, color)
- option: string[]
- createDateTime
- updateDateTime

password
- id: admin
- pw: string
- recentDateTime
- createDateTime
- updateDateTime

데이터 타입 중 string[]은 string을 ","로 이어붙인 데이터를 저장하도록 한다.

추가한 field 데이터가 곧 praycontent의 content 데이터의 키값이 되고 해당 데이터가 저장됨.
결과적으로는 사용자가 praycontent의 필드를 커스터마이징 할 수 있다는 것이다.

다만, 프로젝트에서 관리자만 필드 정보를 수정할 수 있도록 해야하는데, 그건 그냥 특정 모달에서 비밀번호를 입력하면 쿠키를 통해 관리자 권한을 판단하는 것으로 한다.



chore