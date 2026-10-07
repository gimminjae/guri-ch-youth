"use client";
import { useState } from "react";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/domain";
import { api, messageOf } from "@/lib/api-client";
import { Alert, Button, FormField, Input, Modal, Select } from "@/components/ui/ui";
import ui from "@/components/ui/ui.module.css";
import styles from "./prayer.module.css";

function LoginForm({ onLogin, initialRole, onBusy }: { onLogin: (role: Role) => void; initialRole: Role; onBusy: (busy: boolean) => void }) {
  const [role, setRole] = useState<Role>(initialRole), [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const prefix = "participation";
  return <form className={ui.stack} onSubmit={async (e) => { e.preventDefault(); setBusy(true); onBusy?.(true); setError(""); try { const data = await api<{ role: Role }>("session", "POST", { role, password }); setPassword(""); onLogin(data.role); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); onBusy?.(false); } }}>
    <FormField label="참여 권한" htmlFor={`${prefix}-role`}><Select id={`${prefix}-role`} value={role} disabled={busy} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></FormField>
    <FormField label={role === "member" ? "참여 비밀번호" : "관리 비밀번호"} htmlFor={`${prefix}-password`}><Input id={`${prefix}-password`} type="password" autoComplete="current-password" value={password} required disabled={busy} onChange={(e) => setPassword(e.target.value)} placeholder="안내받은 비밀번호를 입력해주세요" /></FormField>
    {error && <Alert>{error}</Alert>}<Button type="submit" busy={busy}>권한 인증하기 <span aria-hidden="true">→</span></Button>
    <p className={styles.loginNote}>기도부탁은 누구나 볼 수 있어요.<br />작성·관리를 위한 비밀번호는 청년회 관리자에게 안내받아주세요.</p>
  </form>;
}
export function ParticipationLogin({ onLogin, onClose, initialRole }: { onLogin: (role: Role) => void; onClose: () => void; initialRole: Role }) {
  const [busy, setBusy] = useState(false);
  return <Modal title="권한으로 참여하기" onClose={onClose} busy={busy}><LoginForm initialRole={initialRole} onLogin={onLogin} onBusy={setBusy} /></Modal>;
}
export function PasswordManager({ onClose, onSignedOut }: { onClose: () => void; onSignedOut: () => void }) {
  const [role, setRole] = useState<Role>("member"), [password, setPassword] = useState(""), [confirm, setConfirm] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  return <Modal title="참여·관리 비밀번호" onClose={onClose} busy={busy}><form onSubmit={async (e) => { e.preventDefault(); setError(""); setNotice(""); if (password !== confirm) { setError("두 비밀번호가 일치하지 않습니다."); return; } setBusy(true); try { const result = await api<{ signedOut: boolean }>("passwords", "PUT", { role, password }); setPassword(""); setConfirm(""); if (result.signedOut) onSignedOut(); else setNotice("비밀번호를 변경했습니다. 해당 권한의 사용자는 다시 인증해야 합니다."); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); } }}>
    <div className={ui.stack}><p className={ui.hint}>비밀번호를 바꾸면 해당 권한으로 참여 중인 모든 사용자의 인증이 해제됩니다.</p>
      <FormField label="변경할 권한" htmlFor="password-role"><Select id="password-role" value={role} disabled={busy} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option value={r} key={r}>{ROLE_LABELS[r]}</option>)}</Select></FormField>
      <FormField label="새 비밀번호" htmlFor="new-password"><Input id="new-password" type="password" autoComplete="new-password" required disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} /></FormField>
      <FormField label="새 비밀번호 확인" htmlFor="confirm-password"><Input id="confirm-password" type="password" autoComplete="new-password" required disabled={busy} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></FormField>
      {error && <Alert>{error}</Alert>}{notice && <Alert notice>{notice}</Alert>}
    </div><div className={ui.actions}><Button variant="secondary" onClick={onClose} disabled={busy}>닫기</Button><Button type="submit" busy={busy}>비밀번호 변경</Button></div>
  </form></Modal>;
}
