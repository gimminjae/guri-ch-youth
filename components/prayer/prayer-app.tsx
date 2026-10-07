"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ROLE_LABELS, canManage, type Field, type Filter, type ListResult, type Prayer, type Role } from "@/lib/domain";
import { api, messageOf } from "@/lib/api-client";
import { useApiResource } from "@/lib/use-api-resource";
import { Alert, Badge, Button, EmptyState, Modal, Pagination } from "@/components/ui/ui";
import { ParticipationLogin, PasswordManager } from "./auth-forms";
import { PrayerEditor } from "./prayer-editor";
import { FieldManager } from "./field-manager";
import { Filters } from "./filters";
import { FieldValue, GroupSection, PrayerCard, formatDateTime } from "./prayer-list";
import ui from "@/components/ui/ui.module.css";
import styles from "./prayer.module.css";

type View = { kind: "new" | "fields" | "passwords" | "auth" } | { kind: "detail" | "edit" | "delete"; prayer: Prayer } | null;
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
  const saved = (prayer: Prayer) => { setView({ kind: "detail", prayer }); setNotice("기도부탁을 저장했습니다."); setPage(1); setRefresh((n) => n + 1); };
  return <div className={styles.app}>
    <header className={styles.header}><Link className={styles.brand} href="/" aria-label="구리교회 청년회 기도 나눔 홈"><span className={styles.brandMark} aria-hidden="true">✧</span><span>구리교회 <small>청년회 기도 나눔</small></span></Link>
      <nav className={styles.headerActions} aria-label="참여 및 관리 메뉴">
        {role && <Badge accent>{ROLE_LABELS[role]}</Badge>}
        {role === "admin" && <><Button variant="ghost" small onClick={() => setView({ kind: "fields" })}>필드 관리</Button><Button variant="ghost" small onClick={() => setView({ kind: "passwords" })}>비밀번호 관리</Button></>}
        <Button variant="secondary" small disabled={checking} aria-haspopup="dialog" onClick={() => setView({ kind: "auth" })}>{checking ? "권한 확인 중…" : role ? "권한 변경" : "참여하기"}</Button>
        {role && <Button variant="ghost" small busy={busy} onClick={async () => { setBusy(true); try { await api("session", "DELETE"); clearSession(); setNotice("참여를 종료했습니다. 기도부탁은 계속 볼 수 있어요."); setError(""); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>나가기</Button>}
      </nav>
    </header>
    <main id="main" className={styles.main}>
        <section className={styles.hero}><div><span className={styles.eyebrow}>PRAY TOGETHER</span><h1>함께 나누는 <em>기도</em></h1><p>서로의 기도를 기억하고, 마음을 모아주세요.</p></div>{role && <Button disabled={!ready || !fields.length} onClick={() => setView({ kind: "new" })}>＋ 기도부탁 나누기</Button>}</section>
        {notice && <div className={styles.message}><Alert notice>{notice}</Alert><Button small variant="ghost" aria-label="안내 닫기" onClick={() => setNotice("")}>✕</Button></div>}
        {visibleError && <div className={styles.message}><Alert>{visibleError}</Alert><Button variant="secondary" small onClick={async () => { try { await refreshFields(); setError(""); resetFilters(); setGroupBy(""); setRefresh((v) => v + 1); } catch (e) { setError(messageOf(e)); } }}>다시 불러오기</Button></div>}
        <div className={styles.board}>
          <Filters key={filterVersion} fields={fields} active={filters} groupBy={groupBy} onGroup={(id) => { setGroupBy(id); setPage(1); }} onApply={(values) => { setFilters(values); setPage(1); }} onReset={resetFilters} />
          <section className={styles.feed} aria-label="기도부탁 목록" aria-busy={loading}>
            <div className={styles.feedHeader}><h2>{filters.length ? "찾은 기도부탁" : "우리의 기도부탁"} <span>{data?.total ?? 0}</span></h2><span className={styles.sortNote}>{groupBy ? `${fields.find((f) => f.id === groupBy)?.name ?? "필드"}별 모아보기` : "최근 나눈 순"}</span></div>
            {!!filters.length && <div className={styles.activeFilters}>{filters.map((filter) => <button key={filter.fieldId} onClick={() => { setFilters(filters.filter((f) => f.fieldId !== filter.fieldId)); setFilterVersion((n) => n + 1); setPage(1); }} aria-label={`${fields.find((f) => f.id === filter.fieldId)?.name} 필터 해제`}>{fields.find((f) => f.id === filter.fieldId)?.name} <span aria-hidden="true">×</span></button>)}</div>}
            {(!ready && !visibleError) || loading ? <div className={styles.loading} role="status">기도부탁을 불러오고 있어요…</div> : !fields.length ? <EmptyState title="기도 나눔을 준비하고 있어요" description={role === "admin" ? "작성할 항목을 추가하고 첫 기도를 나눠보세요." : "관리자가 작성 항목을 준비하면 기도를 나눌 수 있어요."}>{role === "admin" && <Button onClick={() => setView({ kind: "fields" })}>첫 필드 추가하기</Button>}</EmptyState> : data?.total === 0 ? <EmptyState title={filters.length ? "조건에 맞는 기도부탁이 없어요" : "첫 기도부탁을 기다리고 있어요"} description={filters.length ? "필터를 바꾸어 다른 기도를 찾아보세요." : role ? "마음에 품고 있던 기도를 나눠주세요.\n우리 함께 기도할게요." : "상단의 참여하기에서 인증한 뒤 첫 기도부탁을 나눠주세요."}>{(filters.length > 0 || role) && <Button variant={filters.length ? "secondary" : "primary"} onClick={() => filters.length ? resetFilters() : setView({ kind: "new" })}>{filters.length ? "필터 초기화" : "기도부탁 나누기"}</Button>}</EmptyState> : data ? <>
              {groupBy ? <div className={ui.stack}>{data.groups.map((group) => <GroupSection key={`${groupBy}:${group.key}:${JSON.stringify(filters)}`} group={group} groupBy={groupBy} filters={filters} fields={fields} onOpen={openPrayer} refresh={refresh} />)}</div> : <div className={styles.cards}>{data.items.map((prayer) => <PrayerCard key={prayer.id} prayer={prayer} fields={fields} onOpen={openPrayer} />)}</div>}
              <Pagination page={page} pages={groupBy ? data.groupPages : data.pages} onChange={setPage} />
            </> : null}
          </section>
        </div>
    </main>
    <footer className={styles.footer}><span>구리교회 청년회</span><span>기도로 이어지는 우리</span></footer>
    {view?.kind === "auth" && <ParticipationLogin initialRole={role ?? "member"} onClose={() => setView(null)} onLogin={(r) => { setRole(r); setView(null); setError(""); setNotice(`${ROLE_LABELS[r]} 권한으로 인증했습니다.`); setRefresh((n) => n + 1); }} />}
    {view?.kind === "new" && role && <PrayerEditor fields={fields} onClose={() => setView(null)} onSaved={saved} />}
    {view?.kind === "edit" && canManage(role) && <PrayerEditor fields={fields} prayer={view.prayer} onClose={() => setView({ kind: "detail", prayer: view.prayer })} onSaved={saved} />}
    {view?.kind === "fields" && role === "admin" && <FieldManager fields={fields} onClose={() => setView(null)} onChanged={async () => { await refreshFields(); resetFilters(); setGroupBy(""); setRefresh((n) => n + 1); }} />}
    {view?.kind === "passwords" && role === "admin" && <PasswordManager onClose={() => setView(null)} onSignedOut={() => { clearSession(); setNotice("비밀번호를 변경했습니다. 새 비밀번호로 참여해주세요."); }} />}
    {view?.kind === "detail" && <Modal title="함께 기도해주세요" onClose={() => setView(null)}><p className={styles.detailDate}><time dateTime={new Date(view.prayer.createDateTime).toISOString()}>작성 {formatDateTime(view.prayer.createDateTime)}</time><br /><time dateTime={new Date(view.prayer.updateDateTime).toISOString()}>수정 {formatDateTime(view.prayer.updateDateTime)}</time></p><dl className={styles.detailValues}>{fields.map((field) => <div key={field.id}><dt>{field.name}</dt><dd><FieldValue field={field} value={view.prayer.content[field.id]} full /></dd></div>)}</dl><div className={ui.actions}>{canManage(role) && <><Button variant="danger" onClick={() => setView({ kind: "delete", prayer: view.prayer })}>삭제</Button><Button variant="secondary" onClick={() => setView({ kind: "edit", prayer: view.prayer })}>수정</Button></>}<Button onClick={() => setView(null)}>닫기</Button></div></Modal>}
    {view?.kind === "delete" && canManage(role) && <DeletePrayer prayer={view.prayer} onClose={() => setView({ kind: "detail", prayer: view.prayer })} onDeleted={() => { setView(null); setNotice("기도부탁을 삭제했습니다."); setPage(1); setRefresh((n) => n + 1); }} />}
  </div>;
}
function DeletePrayer({ prayer, onClose, onDeleted }: { prayer: Prayer; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Modal title="기도부탁을 삭제할까요?" onClose={onClose} busy={busy}><p>기도 내용과 첨부파일이 삭제되며 되돌릴 수 없습니다.</p>{error && <Alert>{error}</Alert>}<div className={ui.actions}><Button variant="secondary" disabled={busy} onClick={onClose}>취소</Button><Button variant="danger" busy={busy} onClick={async () => { setBusy(true); setError(""); try { await api(`prayers/${prayer.id}`, "DELETE", { updateDateTime: prayer.updateDateTime }); onDeleted(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>기도부탁 삭제</Button></div></Modal>;
}
