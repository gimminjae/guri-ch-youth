"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ROLE_LABELS, canManage, filterText, type Field, type Filter, type ListResult, type Prayer, type Role } from "@/lib/domain";
import { api, messageOf } from "@/lib/api-client";
import { useApiResource } from "@/lib/use-api-resource";
import { Alert, Badge, Button, EmptyState, Modal, Pagination } from "@/components/ui/ui";
import { Icon } from "@/components/ui/icon";
import { ParticipationLogin, PasswordManager } from "./auth-forms";
import { PrayerEditor } from "./prayer-editor";
import { ExcelMenu } from "./excel-menu";
import { Summaries } from "./summaries";
import { FieldManager } from "./field-manager";
import { Filters } from "./filters";
import { FieldValue, GroupSection, PrayerGrid, formatDateTime } from "./prayer-list";
import ui from "@/components/ui/ui.module.css";
import styles from "./prayer.module.css";

type View = { kind: "new" | "fields" | "passwords" | "auth" } | { kind: "excel"; upload?: boolean } | { kind: "detail" | "edit" | "delete"; prayer: Prayer } | null;
export function PrayerApp() {
  const [role, setRole] = useState<Role | null>(null), [checking, setChecking] = useState(true);
  const [fields, setFields] = useState<Field[]>([]), [ready, setReady] = useState(false);
  const [view, setView] = useState<View>(null), [filters, setFilters] = useState<Filter[]>([]), [groupBy, setGroupBy] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [filterVersion, setFilterVersion] = useState(0);
  const resource = useApiResource<ListResult>("prayers/query", { filters, groupBy: groupBy || undefined, page }, ready, refresh);
  const { data, loading } = resource;
  const visibleError = error || resource.error;
  const clearSession = useCallback(() => { setRole(null); setView(null); }, []);
  const refreshFields = useCallback(async () => { const data = await api<{ fields: Field[] }>("fields"); setFields(data.fields); setReady(true); }, []);
  useEffect(() => {
    let current = true;
    api<{ role: Role | null }>("session").then((data) => { if (current) setRole(data.role); }).catch((e) => { if (current) setError(messageOf(e)); }).finally(() => { if (current) setChecking(false); });
    const expired = () => { clearSession(); setNotice("인증이 만료되었습니다. 작성·관리를 계속하려면 상단에서 다시 참여해주세요."); };
    window.addEventListener("prayer-session-expired", expired);
    return () => { current = false; window.removeEventListener("prayer-session-expired", expired); };
  }, [clearSession]);
  useEffect(() => {
    let current = true;
    api<{ fields: Field[] }>("fields").then((result) => { if (current) { setFields(result.fields); setReady(true); } }).catch((e) => { if (current) setError(messageOf(e)); });
    return () => { current = false; };
  }, []);
  const resetFilters = () => { setFilters([]); setPage(1); setFilterVersion((v) => v + 1); };
  const openPrayer = async (id: string) => { setError(""); try { setView({ kind: "detail", prayer: await api<Prayer>(`prayers/${id}`) }); } catch (e) { setError(messageOf(e)); } };
  const applyCountFilter = (filter: Filter) => { setFilters([...filters.filter((f) => f.fieldId !== filter.fieldId), filter]); setFilterVersion((n) => n + 1); setPage(1); };
  const saved = (prayer: Prayer) => { setView({ kind: "detail", prayer }); setNotice("기도부탁을 저장했습니다."); setPage(1); setRefresh((n) => n + 1); };
  return <div className={styles.app}>
    <header className={styles.header}><Link className={styles.brand} href="/" aria-label="구리교회 청년회 기도 나눔 홈"><span className={styles.brandMark}><Icon name="church" size={26} /></span><span>구리교회 <small>청년회 기도 나눔</small></span></Link>
      <nav className={styles.headerActions} aria-label="참여 및 관리 메뉴">
        {role && <Badge accent>{ROLE_LABELS[role]}</Badge>}
        {role === "admin" && <><Button variant="ghost" icon="fields" small onClick={() => setView({ kind: "fields" })}>필드 관리</Button><Button variant="ghost" icon="key" small onClick={() => setView({ kind: "passwords" })}>비밀번호 관리</Button></>}
        {canManage(role) && <Button variant="secondary" icon="upload" small disabled={!ready || !fields.length} onClick={() => setView({ kind: "excel", upload: true })}>엑셀 일괄 등록</Button>}
        <Button variant="secondary" icon="user" small disabled={checking} aria-haspopup="dialog" onClick={() => setView({ kind: "auth" })}>{checking ? "권한 확인 중…" : role ? "권한 변경" : "참여하기"}</Button>
        {role && <Button variant="ghost" icon="logout" small busy={busy} onClick={async () => { setBusy(true); try { await api("session", "DELETE"); clearSession(); setNotice("참여를 종료했습니다. 기도부탁은 계속 볼 수 있어요."); setError(""); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>나가기</Button>}
      </nav>
    </header>
    <main id="main" className={styles.main}>
        <section className={styles.hero}><div><h1><span className={styles.heroIcon}><Icon name="heart" size={28} tone="rose" /></span>함께 나누는 <em>기도</em></h1></div>{role && <Button icon="plus" disabled={!ready || !fields.length} onClick={() => setView({ kind: "new" })}>기도부탁 나누기</Button>}</section>
        {notice && <div className={styles.message}><Alert notice>{notice}</Alert><Button small variant="ghost" icon="close" aria-label="안내 닫기" onClick={() => setNotice("")} /></div>}
        {visibleError && <div className={styles.message}><Alert>{visibleError}</Alert><Button variant="secondary" icon="refresh" small onClick={async () => { try { await refreshFields(); setError(""); resetFilters(); setGroupBy(""); setRefresh((v) => v + 1); } catch (e) { setError(messageOf(e)); } }}>다시 불러오기</Button></div>}
        <div className={styles.board}>
          <section className={styles.feed} aria-label="기도부탁 목록" aria-busy={loading}>
            <div className={styles.feedHeader}><h2><Icon name="list" tone="amber" />{filters.length ? "찾은 기도부탁" : "우리의 기도부탁"} <span>{data?.total ?? 0}</span></h2><div className={ui.row}><Button variant="secondary" small disabled={!ready} onClick={() => setView({ kind: "excel" })}><Icon name="sheet" tone="sage" />엑셀</Button><span className={styles.sortNote}>{groupBy ? `${fields.find((f) => f.id === groupBy)?.name ?? "필드"}별 모아보기` : "최근 나눈 순"}</span></div></div>
            {data && <><Summaries summaries={data.summaries ?? []} fields={fields} query={{ filters, page: 1 }} refresh={refresh} onFilter={applyCountFilter} /></>}
          <Filters key={filterVersion} fields={fields} active={filters} groupBy={groupBy} onGroup={(id) => { setGroupBy(id); setPage(1); }} onApply={(values) => { setFilters(values); setPage(1); }} onReset={resetFilters} />
            {!!filters.length && <div className={styles.activeFilters}>{filters.map((filter) => <button key={filter.fieldId} onClick={() => { setFilters(filters.filter((f) => f.fieldId !== filter.fieldId)); setFilterVersion((n) => n + 1); setPage(1); }} aria-label={`${fields.find((f) => f.id === filter.fieldId)?.name} 필터 해제`}>{fields.find((f) => f.id === filter.fieldId)?.name}: {filterText(filter)} <Icon name="close" size={14} /></button>)}</div>}
            {(!ready && !visibleError) || loading ? <div className={styles.loading} role="status">기도부탁을 불러오고 있어요…</div> : !fields.length ? <EmptyState title="사용 중인 필드 없음">{role === "admin" && <Button icon="fields" onClick={() => setView({ kind: "fields" })}>필드 관리 열기</Button>}</EmptyState> : data?.total === 0 ? <EmptyState title={filters.length ? "검색 결과 없음" : "기도부탁 없음"}>{(filters.length > 0 || role) && <Button icon={filters.length ? "refresh" : "plus"} variant={filters.length ? "secondary" : "primary"} onClick={() => filters.length ? resetFilters() : setView({ kind: "new" })}>{filters.length ? "필터 초기화" : "기도부탁 나누기"}</Button>}</EmptyState> : data ? <>
              {groupBy ? <div className={ui.stack}>{data.groups.map((group) => <GroupSection key={`${groupBy}:${JSON.stringify(group.key)}:${JSON.stringify(filters)}`} group={group} groupBy={groupBy} filters={filters} fields={fields} onOpen={openPrayer} refresh={refresh} onFilter={applyCountFilter} />)}</div> : <PrayerGrid prayers={data.items} fields={fields} onOpen={openPrayer} />}
              <Pagination page={page} pages={groupBy ? data.groupPages : data.pages} onChange={setPage} />
            </> : null}
          </section>
        </div>
    </main>
    <footer className={styles.footer}><span>구리교회 청년회</span><Icon name="heart" size={16} tone="rose" /></footer>
    {view?.kind === "excel" && <ExcelMenu role={role} filters={filters} groupBy={groupBy} initialAction={view.upload ? "upload" : "download"} onClose={() => setView(null)} onImported={(count) => { setView(null); setPage(1); setRefresh((n) => n + 1); setNotice(`엑셀 자료 ${count}건을 저장했습니다.`); }} />}
    {view?.kind === "auth" && <ParticipationLogin initialRole={role ?? "member"} onClose={() => setView(null)} onLogin={(r) => { setRole(r); setView(null); setError(""); setNotice(`${ROLE_LABELS[r]} 권한으로 인증했습니다.`); setRefresh((n) => n + 1); }} />}
    {view?.kind === "new" && role && <PrayerEditor fields={fields} onClose={() => setView(null)} onSaved={saved} />}
    {view?.kind === "edit" && canManage(role) && <PrayerEditor fields={fields} prayer={view.prayer} onClose={() => setView({ kind: "detail", prayer: view.prayer })} onSaved={saved} />}
    {view?.kind === "fields" && role === "admin" && <FieldManager fields={fields} onClose={() => setView(null)} onChanged={async () => { await refreshFields(); resetFilters(); setGroupBy(""); setRefresh((n) => n + 1); }} />}
    {view?.kind === "passwords" && role === "admin" && <PasswordManager onClose={() => setView(null)} onSignedOut={() => { clearSession(); setNotice("비밀번호를 변경했습니다. 새 비밀번호로 참여해주세요."); }} />}
    {view?.kind === "detail" && <Modal icon="heart" title="기도부탁 상세" onClose={() => setView(null)}><p className={styles.detailDate}><time dateTime={new Date(view.prayer.createDateTime).toISOString()}>작성 {formatDateTime(view.prayer.createDateTime)}</time><br /><time dateTime={new Date(view.prayer.updateDateTime).toISOString()}>수정 {formatDateTime(view.prayer.updateDateTime)}</time></p><dl className={styles.detailValues}>{fields.map((field) => <div key={field.id}><dt>{field.name}</dt><dd><FieldValue field={field} value={view.prayer.content[field.id]} full /></dd></div>)}</dl><div className={ui.actions}>{canManage(role) && <><Button variant="danger" icon="trash" onClick={() => setView({ kind: "delete", prayer: view.prayer })}>삭제</Button><Button variant="secondary" icon="edit" onClick={() => setView({ kind: "edit", prayer: view.prayer })}>수정</Button></>}<Button onClick={() => setView(null)}>닫기</Button></div></Modal>}
    {view?.kind === "delete" && canManage(role) && <DeletePrayer prayer={view.prayer} onClose={() => setView({ kind: "detail", prayer: view.prayer })} onDeleted={() => { setView(null); setNotice("기도부탁을 삭제했습니다."); setPage(1); setRefresh((n) => n + 1); }} />}
  </div>;
}
function DeletePrayer({ prayer, onClose, onDeleted }: { prayer: Prayer; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Modal icon="trash" title="기도부탁 삭제" onClose={onClose} busy={busy}><p className={ui.hint}>기도 내용·첨부파일 영구 삭제 · 복구 불가</p>{error && <Alert>{error}</Alert>}<div className={ui.actions}><Button variant="secondary" disabled={busy} onClick={onClose}>취소</Button><Button variant="danger" icon="trash" busy={busy} onClick={async () => { setBusy(true); setError(""); try { await api(`prayers/${prayer.id}`, "DELETE", { updateDateTime: prayer.updateDateTime }); onDeleted(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>기도부탁 삭제</Button></div></Modal>;
}
