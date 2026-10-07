-- Remove password length/character policy while retaining hashes and login rate limits.
-- Existing password hashes and sessions remain valid.
CREATE OR REPLACE FUNCTION prayer_private.password_hash(pw text) RETURNS text
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF pw IS NULL THEN PERFORM prayer_private.fail(400,'비밀번호를 입력해주세요.'); END IF;
 -- Prehash avoids bcrypt's 72-byte truncation, including multibyte passwords.
 RETURN 'bcrypt-sha256:'||extensions.crypt(encode(sha256(convert_to(pw,'UTF8')),'hex'),extensions.gen_salt('bf',10));
END $$;

CREATE OR REPLACE FUNCTION prayer_private.login(body jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE credential prayer_private.password; token text; sid uuid:=gen_random_uuid(); pw text:=body->>'password'; requested_role text:=body->>'role'; correct boolean;
BEGIN
 IF requested_role IS NULL OR requested_role NOT IN ('member','sub-admin','admin') OR jsonb_typeof(body->'password') IS DISTINCT FROM 'string' THEN
  RETURN jsonb_build_object('error','역할과 비밀번호를 확인해주세요.','status',400);
 END IF;
 -- Global per-role bucket cannot be bypassed by forged IP/fingerprint parameters.
 -- Return an error value (not RAISE) so failed-login counters commit through PostgREST.
 IF prayer_private.limited('login:'||requested_role,10,900) THEN RETURN jsonb_build_object('error','요청이 많습니다. 잠시 후 다시 시도해주세요.','status',429,'code','RATE_LIMITED'); END IF;
 SELECT * INTO credential FROM prayer_private.password WHERE id=requested_role FOR UPDATE;
 IF credential.id IS NULL OR credential.pw NOT LIKE 'bcrypt-sha256:%' THEN RETURN jsonb_build_object('error','역할 비밀번호 초기 설정이 필요합니다.','status',503,'code','AUTH_SETUP_REQUIRED'); END IF;
 correct := extensions.crypt(encode(sha256(convert_to(pw,'UTF8')),'hex'),substr(credential.pw,15))=substr(credential.pw,15);
 IF NOT correct THEN RETURN jsonb_build_object('error','역할 또는 비밀번호가 올바르지 않습니다.','status',401,'code','LOGIN_FAILED'); END IF;
 DELETE FROM prayer_private.rate_limits WHERE key=encode(sha256(convert_to('login:'||requested_role,'UTF8')),'hex');
 token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO prayer_private.sessions(id,role,version,"expiresAt",token_hash) VALUES(sid,requested_role,credential."sessionVersion",now()+interval '8 hours',encode(sha256(convert_to(token,'UTF8')),'hex'));
 UPDATE prayer_private.password SET "recentDateTime"=now(),"updateDateTime"=now() WHERE id=requested_role;
 RETURN jsonb_build_object('data',jsonb_build_object('token',token,'role',requested_role));
END $$;

REVOKE ALL ON FUNCTION prayer_private.password_hash(text), prayer_private.login(jsonb) FROM PUBLIC, anon, authenticated, service_role;
