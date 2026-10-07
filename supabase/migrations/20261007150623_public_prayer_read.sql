-- Public reads are limited to field definitions, prayers, and published attachments.
-- Pending uploads remain session-owned; every mutation still requires authentication.
CREATE OR REPLACE FUNCTION prayer_private.dispatch(action text, payload jsonb, session_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE actor prayer_private.sessions; result jsonb; old_field public.praycontentfield; old_prayer public.praycontent; asset prayer_private.assets; target uuid; details text; info jsonb; mime_value text; requested_role text;
BEGIN
 IF action='health' THEN RETURN jsonb_build_object('data',jsonb_build_object('version',3)); END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>524288 THEN PERFORM prayer_private.fail(400,'요청 형식을 확인해주세요.'); END IF;
 IF action='login' THEN RETURN prayer_private.login(payload); END IF;
 IF action IN ('cleanup_list','cleanup_ack') THEN
  IF length(session_token)<32 OR NOT EXISTS(SELECT FROM prayer_private.settings WHERE key='cron_hash' AND value=encode(sha256(convert_to(session_token,'UTF8')),'hex')) THEN PERFORM prayer_private.fail(403,'접근할 수 없습니다.'); END IF;
  IF action='cleanup_list' THEN
   UPDATE prayer_private.assets SET state='deleting' WHERE state IN ('uploading','pending') AND "expiresAt"<now();
   DELETE FROM prayer_private.sessions WHERE "expiresAt"<now(); DELETE FROM prayer_private.rate_limits WHERE "expiresAt"<now();
   SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) INTO result FROM (SELECT id,"objectKey" FROM prayer_private.assets WHERE state='deleting' ORDER BY "createdAt" LIMIT 50) a;
  ELSE DELETE FROM prayer_private.assets WHERE id=(payload->>'id')::uuid AND state='deleting'; result:=jsonb_build_object('ok',true); END IF;
  RETURN jsonb_build_object('data',result);
 END IF;
 actor:=prayer_private.actor(session_token);
 IF action='session' THEN RETURN jsonb_build_object('data',CASE WHEN actor.id IS NULL THEN NULL ELSE jsonb_build_object('role',actor.role,'sessionId',actor.id) END); END IF;
 IF action='logout' THEN DELETE FROM prayer_private.sessions WHERE id=actor.id; RETURN jsonb_build_object('data',jsonb_build_object('ok',true)); END IF;
 IF actor.id IS NULL AND action NOT IN ('fields','prayer','query','file') THEN PERFORM prayer_private.fail(401,'교회 구성원 인증 후 이용해주세요.','UNAUTHORIZED'); END IF;
 IF action IN ('save_field','delete_field','password') AND actor.role<>'admin' THEN PERFORM prayer_private.fail(403,'이 작업을 수행할 권한이 없습니다.','FORBIDDEN'); END IF;
 IF action='delete_prayer' AND actor.role NOT IN ('admin','sub-admin') THEN PERFORM prayer_private.fail(403,'이 작업을 수행할 권한이 없습니다.','FORBIDDEN'); END IF;
 CASE action
 WHEN 'fields' THEN SELECT coalesce(jsonb_agg(prayer_private.field_json(f) ORDER BY "createDateTime",id),'[]'::jsonb) INTO result FROM public.praycontentfield f;
 WHEN 'save_field' THEN result:=prayer_private.save_field(payload);
 WHEN 'delete_field' THEN
  LOCK TABLE public.praycontentfield IN SHARE ROW EXCLUSIVE MODE;
  target:=(payload->>'id')::uuid; SELECT * INTO old_field FROM public.praycontentfield WHERE id=target;
  IF old_field.id IS NULL THEN PERFORM prayer_private.fail(404,'필드를 찾을 수 없습니다.'); END IF;
  IF (payload->>'updateDateTime') IS DISTINCT FROM (to_jsonb(old_field)->>'updateDateTime') THEN PERFORM prayer_private.fail(409,'필드가 변경되었습니다. 새로고침해주세요.'); END IF;
  IF EXISTS(SELECT FROM public.praycontent WHERE content ? target::text OR target::text=ANY(string_to_array(listdisplaydata,','))) THEN PERFORM prayer_private.fail(409,'기도부탁에서 사용 중인 필드는 삭제할 수 없습니다.'); END IF;
  DELETE FROM public.praycontentfield WHERE id=target; result:=jsonb_build_object('ok',true);
 WHEN 'prayer' THEN
  SELECT * INTO old_prayer FROM public.praycontent WHERE id=(payload->>'id')::uuid;
  IF old_prayer.id IS NULL THEN PERFORM prayer_private.fail(404,'기도부탁을 찾을 수 없습니다.'); END IF;
  result:=prayer_private.prayer_json(old_prayer);
 WHEN 'query' THEN result:=prayer_private.query_prayers(payload);
 WHEN 'save_prayer' THEN result:=prayer_private.save_prayer(payload,actor);
 WHEN 'delete_prayer' THEN
  LOCK TABLE public.praycontentfield IN SHARE ROW EXCLUSIVE MODE;
  target:=(payload->>'id')::uuid; SELECT * INTO old_prayer FROM public.praycontent WHERE id=target;
  IF old_prayer.id IS NULL THEN PERFORM prayer_private.fail(404,'기도부탁을 찾을 수 없습니다.'); END IF;
  IF (payload->>'updateDateTime') IS DISTINCT FROM (to_jsonb(old_prayer)->>'updateDateTime') THEN PERFORM prayer_private.fail(409,'내용이 변경되었습니다. 다시 확인해주세요.'); END IF;
  UPDATE prayer_private.assets SET state='deleting' WHERE "prayerId"=target;
  DELETE FROM public.praycontent WHERE id=target; result:=jsonb_build_object('ok',true);
 WHEN 'password' THEN
  requested_role:=payload->>'role';
  IF requested_role IS NULL OR requested_role NOT IN ('member','sub-admin','admin') OR jsonb_typeof(payload->'password') IS DISTINCT FROM 'string' THEN PERFORM prayer_private.fail(400,'역할과 비밀번호를 확인해주세요.'); END IF;
  UPDATE prayer_private.password SET pw=prayer_private.password_hash(payload->>'password'),"sessionVersion"="sessionVersion"+1,"updateDateTime"=clock_timestamp() WHERE id=requested_role;
  DELETE FROM prayer_private.sessions WHERE role=requested_role; result:=jsonb_build_object('ok',true);
 WHEN 'upload_begin' THEN
  SELECT * INTO old_field FROM public.praycontentfield WHERE id=(payload->>'fieldId')::uuid;
  mime_value:=payload->>'mime';
  IF old_field.id IS NULL OR old_field.datatype NOT IN ('file','image') OR mime_value IS NULL OR mime_value NOT IN ('image/jpeg','image/png','image/webp','image/gif','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation') OR (old_field.datatype='image' AND mime_value NOT LIKE 'image/%') OR coalesce((payload->>'size')::integer,0) NOT BETWEEN 1 AND 4194304 OR jsonb_typeof(payload->'name') IS DISTINCT FROM 'string' OR length(payload->>'name') NOT BETWEEN 1 AND 180 THEN PERFORM prayer_private.fail(400,'첨부파일 형식과 크기를 확인해주세요.'); END IF;
  IF prayer_private.limited('upload:'||actor.id,30,3600) THEN PERFORM prayer_private.fail(429,'요청이 많습니다. 잠시 후 다시 시도해주세요.','RATE_LIMITED'); END IF;
  target:=gen_random_uuid();
  INSERT INTO prayer_private.assets(id,"objectKey","fieldId","sessionId",name,mime,size,state,"expiresAt") VALUES(target,'prayers/'||gen_random_uuid()||'/'||target,old_field.id,actor.id,payload->>'name',mime_value,(payload->>'size')::integer,'uploading',now()+interval '1 hour') RETURNING * INTO asset;
  result:=to_jsonb(asset);
 WHEN 'upload_finish','upload_fail' THEN
  UPDATE prayer_private.assets SET state=CASE action WHEN 'upload_finish' THEN 'pending' ELSE 'deleting' END
  WHERE id=(payload->>'id')::uuid AND "sessionId"=actor.id AND state='uploading' AND "expiresAt">now() RETURNING * INTO asset;
  IF asset.id IS NULL THEN PERFORM prayer_private.fail(400,'업로드가 만료되었거나 사용할 수 없습니다.'); END IF;
  result:=jsonb_build_object('ok',true);
 WHEN 'file' THEN
  SELECT * INTO asset FROM prayer_private.assets a WHERE a.id=(payload->>'id')::uuid AND
   ((a.state='pending' AND a."sessionId"=actor.id AND a."expiresAt">now()) OR (a.state='attached' AND EXISTS(SELECT FROM public.praycontent p WHERE p.id=a."prayerId" AND p.content->>a."fieldId"::text=a.id::text)));
  IF asset.id IS NULL THEN PERFORM prayer_private.fail(404,'첨부파일을 찾을 수 없습니다.'); END IF;
  result:=jsonb_build_object('id',asset.id,'objectKey',asset."objectKey",'name',asset.name,'mime',asset.mime,'size',asset.size);
 ELSE PERFORM prayer_private.fail(404,'요청을 찾을 수 없습니다.');
 END CASE;
 RETURN jsonb_build_object('data',result);
EXCEPTION
 WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS details=PG_EXCEPTION_DETAIL;
  info:=coalesce(nullif(details,''),'{}')::jsonb;
  RETURN jsonb_build_object('error',SQLERRM,'status',coalesce((info->>'status')::integer,400),'code',coalesce(info->>'code','INVALID_REQUEST'));
 WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format OR invalid_parameter_value THEN
  RETURN jsonb_build_object('error','입력값의 타입과 범위를 확인해주세요.','status',400,'code','INVALID_REQUEST');
 WHEN unique_violation THEN RETURN jsonb_build_object('error','같은 항목이 이미 있습니다.','status',409,'code','CONFLICT');
END $$;

REVOKE ALL ON FUNCTION prayer_private.dispatch(text,jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION prayer_private.dispatch(text,jsonb,text) TO anon, authenticated;
