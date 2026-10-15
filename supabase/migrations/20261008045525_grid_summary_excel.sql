-- Grid settings, filtered counts and transactional XLSX imports.
ALTER TABLE public.praycontentfield ADD COLUMN IF NOT EXISTS "listOrder" integer;
WITH ranked AS (SELECT id,row_number() OVER (ORDER BY "createDateTime",id)::integer AS n FROM public.praycontentfield)
UPDATE public.praycontentfield f SET "listOrder"=r.n FROM ranked r WHERE r.id=f.id AND f."listOrder" IS NULL;
ALTER TABLE public.praycontentfield ALTER COLUMN "listOrder" SET NOT NULL;
ALTER TABLE public.praycontentfield ALTER COLUMN "listOrder" SET DEFAULT 0;
ALTER TABLE public.praycontentfield ADD COLUMN IF NOT EXISTS "optionColors" jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof("optionColors")='object');
ALTER TABLE public.praycontentfield ADD COLUMN IF NOT EXISTS "isAggregatable" boolean NOT NULL DEFAULT false;
ALTER TABLE public.praycontentfield DROP CONSTRAINT IF EXISTS praycontentfield_datatype_check;
ALTER TABLE public.praycontentfield ADD CONSTRAINT praycontentfield_datatype_check CHECK (datatype IN ('selectbox','selectmultibox','checkbox','shorttext','string','number','date','image','file','bool'));
CREATE OR REPLACE FUNCTION prayer_private.trim_text(v text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT regexp_replace(v,'^[[:space:]]+|[[:space:]]+$','','g') $$;
CREATE OR REPLACE FUNCTION prayer_private.revision() RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT coalesce(string_agg(id::text||':'||(to_jsonb(f)->>'updateDateTime'),'|' ORDER BY "listOrder","createDateTime",id),'') FROM public.praycontentfield f
$$;
CREATE OR REPLACE FUNCTION prayer_private.save_field(body jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE old public.praycontentfield; saved public.praycontentfield; fid uuid:=(body->>'id')::uuid;
 name_value text:=btrim(body->>'name'); kind text:=body->>'datatype'; options text; displays text; removed text[]; colors jsonb:=coalesce(body->'optionColors','{}'); aggregate_flag boolean:=coalesce((body->>'isAggregatable')::boolean,false);
BEGIN
 LOCK TABLE public.praycontentfield IN SHARE ROW EXCLUSIVE MODE;
 IF jsonb_typeof(body->'name') IS DISTINCT FROM 'string' OR length(name_value) NOT BETWEEN 1 AND 100 OR kind IS NULL OR kind NOT IN ('selectbox','selectmultibox','checkbox','shorttext','string','number','date','image','file','bool') THEN PERFORM prayer_private.fail(400,'필드 이름과 타입을 확인해주세요.'); END IF;
 options:=prayer_private.array_csv(body->'option'); displays:=prayer_private.array_csv(body->'displaytype',3);
 IF EXISTS(SELECT FROM jsonb_array_elements_text(body->'option') a(v) WHERE strpos(v,',')>0 OR length(btrim(v))>100) OR
 EXISTS(SELECT FROM unnest(string_to_array(displays,',')) a(v) WHERE v NOT IN ('badge','bold','color')) THEN PERFORM prayer_private.fail(400,'선택지와 표시 방식을 확인해주세요. 쉼표는 선택지에 사용할 수 없습니다.'); END IF;
 IF (kind IN ('selectbox','selectmultibox','checkbox'))<>(options<>'') OR jsonb_typeof(body->'isGroupable') IS DISTINCT FROM 'boolean' OR jsonb_typeof(body->'isFilterable') IS DISTINCT FROM 'boolean' THEN PERFORM prayer_private.fail(400,'필드 선택지와 그룹화·필터링 설정을 확인해주세요.'); END IF;
 IF jsonb_typeof(colors) IS DISTINCT FROM 'object' THEN PERFORM prayer_private.fail(400,'선택지 색상을 확인해주세요.'); END IF;
 IF (body ? 'isAggregatable' AND jsonb_typeof(body->'isAggregatable')<>'boolean') OR EXISTS(SELECT FROM jsonb_each(colors) a(k,v) WHERE NOT k=ANY(string_to_array(options,',')) OR jsonb_typeof(v)<>'string' OR v#>>'{}' !~ '^#[0-9A-Fa-f]{6}$') THEN PERFORM prayer_private.fail(400,'집계 설정과 선택지 색상을 확인해주세요.'); END IF;
 SELECT coalesce(jsonb_object_agg(k,upper(v)),'{}') INTO colors FROM jsonb_each_text(colors) a(k,v);
 IF EXISTS(SELECT FROM public.praycontentfield f WHERE lower(f.name)=lower(name_value) AND f.id IS DISTINCT FROM fid) THEN PERFORM prayer_private.fail(409,'같은 이름의 필드가 있습니다.'); END IF;
 IF fid IS NOT NULL THEN
  SELECT * INTO old FROM public.praycontentfield WHERE id=fid;
  IF old.id IS NULL THEN PERFORM prayer_private.fail(404,'필드를 찾을 수 없습니다.'); END IF;
  IF (body->>'updateDateTime') IS DISTINCT FROM (to_jsonb(old)->>'updateDateTime') THEN PERFORM prayer_private.fail(409,'다른 관리자가 필드를 수정했습니다. 새로고침해주세요.'); END IF;
  IF old.datatype<>kind AND NOT (old.datatype IN ('string','shorttext') AND kind IN ('string','shorttext')) AND EXISTS(SELECT FROM public.praycontent WHERE content ? fid::text OR fid::text=ANY(string_to_array(listdisplaydata,','))) THEN PERFORM prayer_private.fail(409,'사용 중인 필드의 타입은 변경할 수 없습니다.'); END IF;
  IF kind='shorttext' AND EXISTS(SELECT FROM public.praycontent WHERE content->>fid::text ~ E'[\\r\\n]') THEN PERFORM prayer_private.fail(409,'줄바꿈이 있는 글은 짧은 텍스트로 변경할 수 없습니다.'); END IF;
  SELECT array_agg(v) INTO removed FROM unnest(string_to_array(old.option,',')) a(v) WHERE NOT v=ANY(string_to_array(options,','));
  IF removed IS NOT NULL AND EXISTS(SELECT FROM public.praycontent WHERE CASE WHEN old.datatype IN ('selectmultibox','checkbox') THEN string_to_array(content->>fid::text,',') && removed ELSE content->>fid::text=ANY(removed) END) THEN PERFORM prayer_private.fail(409,'사용 중인 선택지는 이름을 바꾸거나 삭제할 수 없습니다.'); END IF;
  UPDATE public.praycontentfield SET "optionColors"=colors,"isAggregatable"=aggregate_flag,name=name_value,datatype=kind,option=options,displaytype=displays,"isGroupable"=(body->>'isGroupable')::boolean,"isFilterable"=(body->>'isFilterable')::boolean,"updateDateTime"=clock_timestamp() WHERE id=fid RETURNING * INTO saved;
 ELSE
  IF (SELECT count(*) FROM public.praycontentfield)>=40 THEN PERFORM prayer_private.fail(400,'필드는 최대 40개까지 등록할 수 있습니다.'); END IF;
  INSERT INTO public.praycontentfield("listOrder","optionColors","isAggregatable",name,datatype,option,displaytype,"isGroupable","isFilterable") VALUES((SELECT coalesce(max("listOrder"),0)+1 FROM public.praycontentfield),colors,aggregate_flag,name_value,kind,options,displays,(body->>'isGroupable')::boolean,(body->>'isFilterable')::boolean) RETURNING * INTO saved;
 END IF;
 RETURN prayer_private.field_json(saved);
END $$;
CREATE OR REPLACE FUNCTION prayer_private.content_value(body jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE result jsonb:='{}'; entry record; f public.praycontentfield; v text; values_array jsonb;
BEGIN
 IF jsonb_typeof(body) IS DISTINCT FROM 'object' THEN PERFORM prayer_private.fail(400,'입력 형식이 올바르지 않습니다.'); END IF;
 FOR entry IN SELECT * FROM jsonb_each(body) LOOP
  SELECT * INTO f FROM public.praycontentfield WHERE id::text=entry.key;
  IF f.id IS NULL THEN PERFORM prayer_private.fail(409,'필드 구성이 변경되었습니다. 새로고침해주세요.','FIELDS_CHANGED'); END IF;
  IF entry.value='null'::jsonb OR entry.value='""'::jsonb THEN CONTINUE; END IF;
  v:=entry.value#>>'{}';
  IF f.datatype='number' THEN
   IF jsonb_typeof(entry.value)<>'number' OR abs(v::numeric)>1e15 THEN PERFORM prayer_private.fail(400,f.name||': 숫자를 확인해주세요.'); END IF;
  ELSIF f.datatype='bool' THEN
   IF jsonb_typeof(entry.value)<>'boolean' THEN PERFORM prayer_private.fail(400,f.name||': 참·거짓 값을 확인해주세요.'); END IF;
  ELSE
   IF jsonb_typeof(entry.value)<>'string' OR length(v)>10000 THEN PERFORM prayer_private.fail(400,f.name||': 입력값을 확인해주세요.'); END IF;
   IF f.datatype='date' AND NOT prayer_private.date_valid(v) THEN PERFORM prayer_private.fail(400,f.name||': 날짜를 확인해주세요.'); END IF;
   IF f.datatype='selectbox' AND NOT v=ANY(string_to_array(f.option,',')) THEN PERFORM prayer_private.fail(400,f.name||': 선택지를 확인해주세요.'); END IF;
   IF f.datatype IN ('selectmultibox','checkbox') THEN
    values_array:=prayer_private.csv_values(v);
    IF EXISTS(SELECT FROM jsonb_array_elements_text(values_array) a(x) WHERE NOT x=ANY(string_to_array(f.option,','))) THEN PERFORM prayer_private.fail(400,f.name||': 선택지를 확인해주세요.'); END IF;
    v:=prayer_private.array_csv(values_array);
    IF v='' THEN CONTINUE; END IF;
    entry.value:=to_jsonb(v);
   END IF;
   IF f.datatype IN ('image','file') AND v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN PERFORM prayer_private.fail(400,'첨부파일 식별자가 올바르지 않습니다.'); END IF;
   IF f.datatype='shorttext' AND v ~ E'[\\r\\n]' THEN PERFORM prayer_private.fail(400,f.name||': 줄바꿈 없이 입력해주세요.'); END IF;
   IF f.datatype IN ('string','shorttext') AND prayer_private.trim_text(v)='' THEN CONTINUE; END IF;
  END IF;
  result:=result||jsonb_build_object(entry.key,entry.value);
 END LOOP;
 IF result='{}'::jsonb THEN PERFORM prayer_private.fail(400,'기도 내용을 한 항목 이상 입력해주세요.'); END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION prayer_private.save_prayer_impl(body jsonb, actor prayer_private.sessions, bulk boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE pid uuid:=(body->>'id')::uuid; previous public.praycontent; saved public.praycontent; content_value jsonb; display text; f record; asset prayer_private.assets; files uuid[]:=ARRAY[]::uuid[];
BEGIN
 IF pid IS NOT NULL AND actor.role NOT IN ('admin','sub-admin') THEN PERFORM prayer_private.fail(403,'이 작업을 수행할 권한이 없습니다.','FORBIDDEN'); END IF;
 LOCK TABLE public.praycontentfield IN SHARE ROW EXCLUSIVE MODE;
 IF (body->>'fieldRevision') IS DISTINCT FROM prayer_private.revision() THEN PERFORM prayer_private.fail(409,'필드 구성이 변경되었습니다. 내용을 복사한 뒤 새로고침해주세요.','FIELDS_CHANGED'); END IF;
 content_value:=prayer_private.content_value(body->'content'); display:=prayer_private.array_csv(body->'listdisplaydata',40);
 IF EXISTS(SELECT FROM unnest(string_to_array(display,',')) a(v) WHERE NOT EXISTS(SELECT FROM public.praycontentfield WHERE id::text=v)) THEN PERFORM prayer_private.fail(400,'목록에 표시할 필드를 확인해주세요.'); END IF;
 IF pid IS NOT NULL THEN
  SELECT * INTO previous FROM public.praycontent WHERE id=pid;
  IF previous.id IS NULL THEN PERFORM prayer_private.fail(404,'기도부탁을 찾을 수 없습니다.'); END IF;
  IF (body->>'updateDateTime') IS DISTINCT FROM (to_jsonb(previous)->>'updateDateTime') THEN PERFORM prayer_private.fail(409,'다른 관리자가 수정한 내용이 있습니다. 새로고침해주세요.','CONFLICT'); END IF;
 ELSE
  IF NOT bulk AND prayer_private.limited('create:'||actor.id,20,3600) THEN PERFORM prayer_private.fail(429,'요청이 많습니다. 잠시 후 다시 시도해주세요.','RATE_LIMITED'); END IF;
  pid:=gen_random_uuid();
 END IF;
 FOR f IN SELECT * FROM public.praycontentfield WHERE datatype IN ('image','file') AND content_value ? id::text LOOP
  SELECT * INTO asset FROM prayer_private.assets WHERE id=(content_value->>f.id::text)::uuid AND "fieldId"=f.id
   AND ((state='pending' AND "sessionId"=actor.id AND "expiresAt">now()) OR (state='attached' AND "prayerId"=pid)) FOR UPDATE;
  IF asset.id IS NULL OR asset.id=ANY(files) THEN PERFORM prayer_private.fail(400,f.name||': 첨부파일이 만료되었거나 사용할 수 없습니다. 다시 첨부해주세요.'); END IF;
  IF f.datatype='image' AND asset.mime NOT LIKE 'image/%' THEN PERFORM prayer_private.fail(400,f.name||': 이미지 파일을 첨부해주세요.'); END IF;
  files:=array_append(files,asset.id);
 END LOOP;
 IF previous.id IS NOT NULL THEN UPDATE public.praycontent SET content=content_value,listdisplaydata=display,"updateDateTime"=clock_timestamp() WHERE id=pid RETURNING * INTO saved;
 ELSE INSERT INTO public.praycontent(id,content,listdisplaydata) VALUES(pid,content_value,display) RETURNING * INTO saved; END IF;
 UPDATE prayer_private.assets SET state='deleting' WHERE "prayerId"=pid AND NOT id=ANY(files);
 UPDATE prayer_private.assets SET state='attached',"prayerId"=pid,"expiresAt"=NULL WHERE id=ANY(files);
 RETURN prayer_private.prayer_json(saved);
END $$;
CREATE OR REPLACE FUNCTION prayer_private.save_prayer(body jsonb, actor prayer_private.sessions) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS $$ SELECT prayer_private.save_prayer_impl(body,actor,false) $$;
CREATE OR REPLACE FUNCTION prayer_private.filter_sql(filters jsonb) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE item jsonb; f public.praycontentfield; seen text[]:=ARRAY[]::text[]; predicate text:='TRUE'; expression text; part text; op text; bound text; value jsonb; cast_type text;
BEGIN
 IF jsonb_typeof(filters) IS DISTINCT FROM 'array' THEN PERFORM prayer_private.fail(400,'필터 조건을 확인해주세요.'); END IF;
 IF jsonb_array_length(filters)>40 THEN PERFORM prayer_private.fail(400,'필터 조건이 너무 많습니다.'); END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(filters) LOOP
  SELECT * INTO f FROM public.praycontentfield WHERE id::text=item->>'fieldId' AND "isFilterable";
  IF f.id IS NULL THEN PERFORM prayer_private.fail(409,'필터 설정이 변경되었습니다. 조회 조건을 초기화해주세요.','FIELDS_CHANGED'); END IF;
  IF f.id::text=ANY(seen) THEN PERFORM prayer_private.fail(400,'동일한 필드의 필터를 중복할 수 없습니다.'); END IF;
  seen:=array_append(seen,f.id::text); op:=item->>'op'; value:=item->'value';
  expression:=format('NULLIF(prayer_private.trim_text(p.content->>%L),'''')',f.id::text);
  IF op IN ('empty','present') THEN part:=expression||CASE op WHEN 'empty' THEN ' IS NULL' ELSE ' IS NOT NULL' END;
  ELSIF f.datatype IN ('selectbox','selectmultibox','checkbox') THEN
   IF op IS DISTINCT FROM 'in' OR jsonb_typeof(value) IS DISTINCT FROM 'array' THEN PERFORM prayer_private.fail(400,f.name||': 필터 조건을 확인해주세요.'); END IF;
   value:=prayer_private.csv_values(prayer_private.array_csv(value));
   IF jsonb_array_length(value)=0 OR EXISTS(SELECT FROM jsonb_array_elements_text(value) a(v) WHERE NOT v=ANY(string_to_array(f.option,','))) THEN PERFORM prayer_private.fail(400,f.name||': 선택지를 확인해주세요.'); END IF;
   IF f.datatype='selectbox' THEN part:=format('%s = ANY(ARRAY(SELECT jsonb_array_elements_text(%L::jsonb)))',expression,value::text);
   ELSE part:=format('string_to_array(%s,'','') && ARRAY(SELECT jsonb_array_elements_text(%L::jsonb))',expression,value::text); END IF;
  ELSIF f.datatype IN ('string','shorttext') THEN
   IF (op IS NULL OR op NOT IN ('contains','eq')) OR jsonb_typeof(value) IS DISTINCT FROM 'string' OR length(prayer_private.trim_text(item->>'value')) NOT BETWEEN 1 AND (CASE WHEN op='eq' THEN 10000 ELSE 500 END) THEN PERFORM prayer_private.fail(400,f.name||': 검색어를 확인해주세요.'); END IF;
   IF op='eq' THEN part:=format('%s=%L',expression,prayer_private.trim_text(item->>'value')); ELSE part:=format('strpos(lower(%s),lower(%L))>0',expression,prayer_private.trim_text(item->>'value')); END IF;
  ELSIF f.datatype='bool' THEN
   IF op IS DISTINCT FROM 'eq' OR jsonb_typeof(value) IS DISTINCT FROM 'boolean' THEN PERFORM prayer_private.fail(400,f.name||': 참·거짓 조건을 확인해주세요.'); END IF;
   part:=format('%s = %L',expression,item->>'value');
  ELSIF f.datatype IN ('number','date') THEN
   IF op IS NULL OR op NOT IN ('eq','range') OR (op='range' AND NOT (item ? 'min' OR item ? 'max')) THEN PERFORM prayer_private.fail(400,f.name||': 범위를 확인해주세요.'); END IF;
   cast_type:=CASE f.datatype WHEN 'number' THEN 'numeric' ELSE 'text' END;
   part:='TRUE';
   FOREACH bound IN ARRAY CASE op WHEN 'eq' THEN ARRAY['value'] ELSE ARRAY['min','max'] END LOOP
    IF NOT item ? bound THEN CONTINUE; END IF;
    IF f.datatype='number' THEN
     IF jsonb_typeof(item->bound) IS DISTINCT FROM 'number' OR abs((item->>bound)::numeric)>1e15 THEN PERFORM prayer_private.fail(400,f.name||': 숫자 범위를 확인해주세요.'); END IF;
    ELSIF jsonb_typeof(item->bound) IS DISTINCT FROM 'string' OR NOT prayer_private.date_valid(item->>bound) THEN PERFORM prayer_private.fail(400,f.name||': 날짜를 확인해주세요.'); END IF;
    part:=part||format(' AND (%s)::%s %s %L::%s',expression,cast_type,CASE bound WHEN 'min' THEN '>=' WHEN 'max' THEN '<=' ELSE '=' END,item->>bound,cast_type);
   END LOOP;
   IF item ? 'min' AND item ? 'max' THEN
    IF (f.datatype='number' AND (item->>'min')::numeric>(item->>'max')::numeric) OR (f.datatype='date' AND item->>'min'>item->>'max') THEN PERFORM prayer_private.fail(400,f.name||': 시작은 끝보다 작아야 합니다.'); END IF;
   END IF;
  ELSE PERFORM prayer_private.fail(400,f.name||': 필터 조건을 확인해주세요.');
  END IF;
  predicate:=predicate||' AND ('||part||')';
 END LOOP;
 RETURN predicate;
END $$;
CREATE OR REPLACE FUNCTION prayer_private.query_page(body jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE f public.praycontentfield; page integer:=coalesce((body->>'page')::integer,1); predicate text; base text; expression text; expansion text; ordering text; result jsonb; label_sql text;
BEGIN
 IF page<1 OR page>100000 OR (body ? 'page' AND (jsonb_typeof(body->'page')<>'number' OR (body->>'page')::numeric<>page)) THEN PERFORM prayer_private.fail(400,'페이지 번호를 확인해주세요.'); END IF;
 predicate:=prayer_private.filter_sql(body->'filters');
 base:='WITH filtered AS MATERIALIZED (SELECT p.* FROM public.praycontent p WHERE '||predicate||')';
 IF coalesce(body->>'groupBy','')='' THEN
  IF body ? 'groupKey' THEN PERFORM prayer_private.fail(400,'그룹을 확인해주세요.'); END IF;
  EXECUTE base||format(' SELECT jsonb_build_object(''total'',(SELECT count(*) FROM filtered),''page'',%s,''pages'',greatest(1,ceil((SELECT count(*) FROM filtered)/12.0)),''groupCount'',0,''groupPages'',1,''groups'',''[]''::jsonb,''items'',coalesce((SELECT jsonb_agg(prayer_private.prayer_json(r::public.praycontent)) FROM (SELECT * FROM filtered ORDER BY "createDateTime" DESC,id DESC LIMIT 12 OFFSET %s) r),''[]''::jsonb))',page,(page-1)*12) INTO result;
  RETURN result;
 END IF;
 SELECT * INTO f FROM public.praycontentfield WHERE id::text=body->>'groupBy' AND "isGroupable";
 IF f.id IS NULL THEN PERFORM prayer_private.fail(409,'그룹화 설정이 변경되었습니다. 조회 조건을 초기화해주세요.','FIELDS_CHANGED'); END IF;
 IF body ? 'groupKey' AND (jsonb_typeof(body->'groupKey') NOT IN ('string','null') OR length(body->>'groupKey')>10000) THEN PERFORM prayer_private.fail(400,'그룹을 확인해주세요.'); END IF;
 expression:=format('NULLIF(prayer_private.trim_text(p.content->>%L),'''')',f.id::text);
 IF f.datatype IN ('selectmultibox','checkbox') THEN expansion:=format('SELECT DISTINCT unnest(coalesce(string_to_array(%s,'',''),ARRAY[NULL::text])) AS key',expression);
 ELSIF f.datatype IN ('file','image') THEN expansion:=format('SELECT CASE WHEN %s IS NULL THEN NULL ELSE ''attached'' END AS key',expression);
 ELSE expansion:='SELECT '||expression||' AS key'; END IF;
 base:=base||', expanded AS MATERIALIZED (SELECT p.*,g.key FROM filtered p CROSS JOIN LATERAL ('||expansion||') g), grouped AS (SELECT key,count(*) AS count FROM expanded GROUP BY key)';
 IF body ? 'groupKey' THEN
  EXECUTE base||format(' SELECT jsonb_build_object(''total'',(SELECT count(*) FROM filtered),''page'',%s,''pages'',greatest(1,ceil((SELECT count(*) FROM expanded WHERE key IS NOT DISTINCT FROM %L)/12.0)),''groupCount'',(SELECT count(*) FROM grouped),''groupPages'',greatest(1,ceil((SELECT count(*) FROM grouped)/12.0)),''groups'',''[]''::jsonb,''items'',coalesce((SELECT jsonb_agg(prayer_private.prayer_json(r::public.praycontent)) FROM (SELECT id,content,listdisplaydata,"createDateTime","updateDateTime" FROM expanded WHERE key IS NOT DISTINCT FROM %L ORDER BY "createDateTime" DESC,id DESC LIMIT 12 OFFSET %s) r),''[]''::jsonb))',page,body->>'groupKey',body->>'groupKey',(page-1)*12) INTO result;
 ELSE
  ordering:='(key IS NULL) ASC,';
  IF f.datatype='number' THEN ordering:=ordering||'key::numeric ASC';
  ELSIF f.option<>'' THEN ordering:=ordering||format('array_position(string_to_array(%L,'',''),key) ASC,key ASC',f.option);
  ELSE ordering:=ordering||'key ASC'; END IF;
  label_sql:=CASE WHEN f.datatype IN ('file','image') THEN 'CASE WHEN key IS NULL THEN ''첨부 없음'' ELSE ''첨부 있음'' END' WHEN f.datatype='bool' THEN 'CASE WHEN key IS NULL THEN ''미입력'' WHEN key=''true'' THEN ''예'' ELSE ''아니오'' END' ELSE 'coalesce(key,''미입력'')' END;
  EXECUTE base||format(' SELECT jsonb_build_object(''total'',(SELECT count(*) FROM filtered),''page'',%s,''pages'',greatest(1,ceil((SELECT count(*) FROM filtered)/12.0)),''groupCount'',(SELECT count(*) FROM grouped),''groupPages'',greatest(1,ceil((SELECT count(*) FROM grouped)/12.0)),''items'',''[]''::jsonb,''groups'',coalesce((SELECT jsonb_agg(jsonb_build_object(''key'',key,''count'',count,''label'',%s)) FROM (SELECT * FROM grouped ORDER BY %s LIMIT 12 OFFSET %s) r),''[]''::jsonb))',page,label_sql,ordering,(page-1)*12) INTO result;
 END IF;
 RETURN result;
END $$;

-- A single value interpretation is shared by summaries and group scopes.
CREATE OR REPLACE FUNCTION prayer_private.value_keys(f public.praycontentfield, content jsonb) RETURNS SETOF text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v text:=nullif(prayer_private.trim_text(content->>f.id::text),'');
BEGIN
 IF f.datatype IN ('selectmultibox','checkbox') THEN
  RETURN QUERY SELECT DISTINCT unnest(coalesce(string_to_array(v,','),ARRAY[NULL::text]));
 ELSIF f.datatype IN ('image','file') THEN RETURN NEXT CASE WHEN v IS NULL THEN NULL ELSE 'attached' END;
 ELSE RETURN NEXT v; END IF;
END $$;
CREATE OR REPLACE FUNCTION prayer_private.value_label(kind text, v text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE WHEN kind IN ('image','file') THEN CASE WHEN v IS NULL THEN '첨부 없음' ELSE '첨부 있음' END
 WHEN v IS NULL THEN '미입력' WHEN kind='bool' THEN CASE v WHEN 'true' THEN '예' ELSE '아니오' END ELSE v END
$$;
CREATE OR REPLACE FUNCTION prayer_private.scope_sql(body jsonb) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE predicate text:=prayer_private.filter_sql(body->'filters'); f public.praycontentfield;
BEGIN
 IF coalesce(body->>'groupBy','')<>'' THEN
  SELECT * INTO f FROM public.praycontentfield WHERE id::text=body->>'groupBy' AND "isGroupable";
  IF f.id IS NULL THEN PERFORM prayer_private.fail(409,'그룹화 설정이 변경되었습니다.','FIELDS_CHANGED'); END IF;
  IF body ? 'groupKey' THEN
   IF jsonb_typeof(body->'groupKey') NOT IN ('string','null') OR length(body->>'groupKey')>10000 THEN PERFORM prayer_private.fail(400,'그룹을 확인해주세요.'); END IF;
   predicate:=predicate||format(' AND EXISTS (SELECT FROM prayer_private.value_keys((SELECT f FROM public.praycontentfield f WHERE id=%L::uuid),p.content) k WHERE k IS NOT DISTINCT FROM %L)',f.id,body->>'groupKey');
  END IF;
 ELSIF body ? 'groupKey' THEN PERFORM prayer_private.fail(400,'그룹을 확인해주세요.'); END IF;
 RETURN predicate;
END $$;
CREATE OR REPLACE FUNCTION prayer_private.summaries_impl(body jsonb, full_values boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE predicate text:=prayer_private.scope_sql(body); f public.praycontentfield; result jsonb:='[]'; one jsonb; base text;
 page integer:=coalesce((body->>'summaryPage')::integer,1); limit_value integer;
BEGIN
 IF page NOT BETWEEN 1 AND 100000 OR (body ? 'summaryPage' AND (jsonb_typeof(body->'summaryPage')<>'number' OR (body->>'summaryPage')::numeric<>page)) THEN PERFORM prayer_private.fail(400,'집계 페이지를 확인해주세요.'); END IF;
 IF body ? 'summaryField' AND NOT EXISTS(SELECT FROM public.praycontentfield WHERE id::text=body->>'summaryField' AND "isAggregatable") THEN PERFORM prayer_private.fail(409,'집계 설정이 변경되었습니다.','FIELDS_CHANGED'); END IF;
 FOR f IN SELECT * FROM public.praycontentfield WHERE "isAggregatable" AND (NOT body ? 'summaryField' OR id::text=body->>'summaryField') ORDER BY "listOrder","createDateTime",id LOOP
  IF full_values THEN page:=1; END IF;
  limit_value:=CASE WHEN full_values THEN 1000000 WHEN f.option<>'' THEN 61 ELSE 12 END;
  base:=format('WITH filtered AS MATERIALIZED (SELECT p.* FROM public.praycontent p WHERE %s), counts AS (SELECT k AS key,count(DISTINCT p.id) AS count FROM filtered p CROSS JOIN LATERAL prayer_private.value_keys((SELECT f FROM public.praycontentfield f WHERE f.id=%L::uuid),p.content) k GROUP BY k), keys AS (SELECT key FROM counts UNION SELECT unnest(string_to_array(%L,'','')) UNION SELECT NULL::text), counted AS (SELECT k.key,coalesce(c.count,0) AS count FROM keys k LEFT JOIN counts c ON c.key IS NOT DISTINCT FROM k.key)',predicate,f.id,f.option);
  EXECUTE base||format(' SELECT jsonb_build_object(''fieldId'',%L,''total'',(SELECT count(*) FROM filtered),''valueCount'',(SELECT count(*) FROM counted),''page'',%s,''pages'',greatest(1,ceil((SELECT count(*) FROM counted)/%s::numeric)),''values'',coalesce((SELECT jsonb_agg(jsonb_build_object(''key'',key,''label'',prayer_private.value_label(%L,key),''count'',count)) FROM (SELECT * FROM counted ORDER BY (key IS NULL),CASE WHEN %L<>'''' THEN array_position(string_to_array(%L,'',''),key) END,count DESC,key LIMIT %s OFFSET %s) r),''[]''::jsonb))',f.id,page,limit_value,f.datatype,f.option,f.option,limit_value,(page-1)*limit_value) INTO one;
  result:=result||jsonb_build_array(one);
 END LOOP;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION prayer_private.summaries(body jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT prayer_private.summaries_impl(body,false) $$;
CREATE OR REPLACE FUNCTION prayer_private.query_prayers(body jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE result jsonb:=prayer_private.query_page(body); groups jsonb:='[]'; g jsonb;
BEGIN
 FOR g IN SELECT * FROM jsonb_array_elements(result->'groups') LOOP
  groups:=groups||jsonb_build_array(g||jsonb_build_object('summaries',prayer_private.summaries((body-'summaryField'-'summaryPage')||jsonb_build_object('groupKey',g->'key'))));
 END LOOP;
 RETURN result||jsonb_build_object('groups',groups,'summaries',prayer_private.summaries(body-'summaryField'-'summaryPage'));
END $$;
CREATE OR REPLACE FUNCTION prayer_private.reorder_fields(body jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE ids jsonb:=body->'ids';
BEGIN
 LOCK TABLE public.praycontentfield IN SHARE ROW EXCLUSIVE MODE;
 IF body->>'fieldRevision' IS DISTINCT FROM prayer_private.revision() THEN PERFORM prayer_private.fail(409,'필드 순서 또는 구성이 변경되었습니다. 새로고침해주세요.','FIELDS_CHANGED'); END IF;
 IF jsonb_typeof(ids) IS DISTINCT FROM 'array' THEN PERFORM prayer_private.fail(400,'전체 필드 순서를 전달해주세요.'); END IF;
 IF jsonb_array_length(ids)<>(SELECT count(*) FROM public.praycontentfield) OR
 (SELECT count(DISTINCT v) FROM jsonb_array_elements_text(ids) a(v))<>jsonb_array_length(ids) OR
 EXISTS(SELECT FROM jsonb_array_elements_text(ids) a(v) WHERE NOT EXISTS(SELECT FROM public.praycontentfield WHERE id::text=v)) THEN PERFORM prayer_private.fail(400,'필드 순서에 누락·중복·알 수 없는 필드가 있습니다.'); END IF;
 UPDATE public.praycontentfield f SET "listOrder"=a.n::integer,"updateDateTime"=clock_timestamp() FROM jsonb_array_elements_text(ids) WITH ORDINALITY a(v,n) WHERE f.id::text=a.v;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE OR REPLACE FUNCTION prayer_private.export_snapshot(body jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE predicate text:=prayer_private.scope_sql(body-'groupKey'); total integer; bytes bigint; items jsonb; fields jsonb; groups jsonb:='[]'; g jsonb; page integer:=1; part jsonb;
BEGIN
 EXECUTE 'SELECT count(*),coalesce(sum(octet_length(content::text)),0) FROM public.praycontent p WHERE '||predicate INTO total,bytes;
 IF total>500 OR bytes>8388608 THEN PERFORM prayer_private.fail(413,'엑셀 다운로드는 500건·본문 8MB까지 가능합니다. 필터로 범위를 줄여주세요.'); END IF;
 EXECUTE 'SELECT coalesce(jsonb_agg(prayer_private.prayer_json(p) ORDER BY p."createDateTime" DESC,p.id DESC),''[]'') FROM public.praycontent p WHERE '||predicate INTO items;
 SELECT coalesce(jsonb_agg(prayer_private.field_json(f) ORDER BY "listOrder","createDateTime",id),'[]') INTO fields FROM public.praycontentfield f;
 IF coalesce(body->>'groupBy','')<>'' THEN
  LOOP
   part:=prayer_private.query_page((body-'groupKey')||jsonb_build_object('page',page));
   FOR g IN SELECT * FROM jsonb_array_elements(part->'groups') LOOP
    groups:=groups||jsonb_build_array(g||jsonb_build_object('summaries',prayer_private.summaries_impl((body-'summaryField'-'summaryPage')||jsonb_build_object('groupKey',g->'key'),true)));
   END LOOP;
   IF octet_length(groups::text)>8388608 THEN PERFORM prayer_private.fail(413,'그룹 집계가 너무 큽니다. 그룹화를 해제하거나 필터로 범위를 줄여주세요.'); END IF;
   EXIT WHEN page>=(part->>'groupPages')::integer;
   page:=page+1;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('fields',fields,'items',items,'total',total,'groups',groups,'summaries',prayer_private.summaries_impl(body-'groupKey'-'summaryField'-'summaryPage',true),'fieldRevision',prayer_private.revision());
END $$;

CREATE TABLE IF NOT EXISTS prayer_private.import_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "sessionId" uuid NOT NULL REFERENCES prayer_private.sessions(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, result jsonb, "expiresAt" timestamptz NOT NULL DEFAULT now()+interval '30 minutes'
);
CREATE INDEX IF NOT EXISTS import_jobs_session ON prayer_private.import_jobs("sessionId");
ALTER TABLE prayer_private.import_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prayer_private.import_jobs FROM PUBLIC,anon,authenticated,service_role;

-- Revalidate at both preview and commit. Unmapped keys are preserved; explicit null clears.
CREATE OR REPLACE FUNCTION prayer_private.import_rows(body jsonb, actor prayer_private.sessions, commit_rows boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE r jsonb; old public.praycontent; merged jsonb; normalized jsonb; display jsonb; mode text:=body->>'mode'; seen text[]:=ARRAY[]::text[]; f public.praycontentfield; errors jsonb:='[]'; previews jsonb:='[]'; details text; idx integer:=1;
BEGIN
 LOCK TABLE public.praycontentfield IN SHARE ROW EXCLUSIVE MODE;
 IF actor.id IS NULL OR actor.role NOT IN ('admin','sub-admin') THEN PERFORM prayer_private.fail(403,'엑셀 업로드 권한이 없습니다.','FORBIDDEN'); END IF;
 IF body->>'fieldRevision' IS DISTINCT FROM prayer_private.revision() THEN PERFORM prayer_private.fail(409,'필드 구성이 변경되었습니다. 파일을 다시 확인해주세요.','FIELDS_CHANGED'); END IF;
 IF mode IS NULL OR mode NOT IN ('add','update') OR jsonb_typeof(body->'rows') IS DISTINCT FROM 'array' THEN PERFORM prayer_private.fail(400,'엑셀 입력 형식을 확인해주세요.'); END IF;
 IF jsonb_array_length(body->'rows') NOT BETWEEN 1 AND 500 THEN PERFORM prayer_private.fail(400,'엑셀은 1~500개 데이터 행을 포함해야 합니다.'); END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(body->'rows') LOOP
  idx:=idx+1;
  BEGIN
   old:=NULL;
   IF jsonb_typeof(r->'content') IS DISTINCT FROM 'object' THEN PERFORM prayer_private.fail(400,'행의 입력 형식을 확인해주세요.'); END IF;
   IF mode='add' THEN
    IF coalesce(r->>'id','')<>'' THEN PERFORM prayer_private.fail(400,'새로 추가할 때는 기도부탁 ID를 비워주세요. 기존 자료 수정 모드를 사용할 수 있습니다.'); END IF;
    merged:=r->'content'; display:=coalesce(r->'listdisplaydata',(SELECT coalesce(jsonb_agg(id::text ORDER BY "listOrder","createDateTime",id),'[]') FROM public.praycontentfield));
   ELSE
    IF coalesce(r->>'id','')='' OR r->>'id'=ANY(seen) THEN PERFORM prayer_private.fail(400,'기존 자료 ID가 없거나 중복됩니다.'); END IF;
    seen:=array_append(seen,r->>'id');
    SELECT * INTO old FROM public.praycontent WHERE id=(r->>'id')::uuid FOR UPDATE;
    IF old.id IS NULL THEN PERFORM prayer_private.fail(404,'수정할 기도부탁이 없습니다.'); END IF;
    IF r->>'updateDateTime' IS DISTINCT FROM to_jsonb(old)->>'updateDateTime' THEN PERFORM prayer_private.fail(409,'자료가 수정되었습니다. 다시 내려받아 확인해주세요.','CONFLICT'); END IF;
    merged:=old.content||(r->'content'); display:=coalesce(r->'listdisplaydata',prayer_private.csv_values(old.listdisplaydata));
   END IF;
   FOR f IN SELECT * FROM public.praycontentfield WHERE datatype IN ('image','file') LOOP
    IF (r->'content' ? f.id::text) AND (r->'content'->f.id::text IS DISTINCT FROM coalesce(old.content->f.id::text,'null'::jsonb)) THEN PERFORM prayer_private.fail(400,f.name||': 첨부파일은 엑셀로 추가·교체·해제할 수 없습니다.'); END IF;
   END LOOP;
   normalized:=prayer_private.content_value(merged);
   PERFORM prayer_private.array_csv(display,40);
   IF EXISTS(SELECT FROM jsonb_array_elements_text(display) a(v) WHERE NOT EXISTS(SELECT FROM public.praycontentfield WHERE id::text=v)) THEN PERFORM prayer_private.fail(400,'목록 표시 필드가 올바르지 않습니다.'); END IF;
   IF commit_rows THEN PERFORM prayer_private.save_prayer_impl(jsonb_build_object('id',old.id,'updateDateTime',r->>'updateDateTime','content',normalized,'listdisplaydata',display,'fieldRevision',body->>'fieldRevision'),actor,true); END IF;
   previews:=previews||jsonb_build_array(jsonb_build_object('row',idx,'content',(SELECT coalesce(jsonb_object_agg(k,v),'{}') FROM jsonb_each(normalized) a(k,v) WHERE r->'content' ? k),'cleared',coalesce((SELECT jsonb_agg(k) FROM jsonb_each(r->'content') a(k,v) WHERE v='null'::jsonb AND old.content ? k),'[]')));
  EXCEPTION WHEN raise_exception OR invalid_text_representation THEN
   IF commit_rows THEN RAISE; END IF;
   errors:=errors||jsonb_build_array(jsonb_build_object('row',idx,'message',SQLERRM));
  END;
 END LOOP;
 RETURN jsonb_build_object('mode',mode,'count',jsonb_array_length(body->'rows'),'errors',errors,'rows',previews);
END $$;
CREATE OR REPLACE FUNCTION prayer_private.import_preview(body jsonb, actor prayer_private.sessions) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE result jsonb; job uuid;
BEGIN
 IF prayer_private.limited('import-preview:'||actor.id,30,3600) THEN PERFORM prayer_private.fail(429,'업로드 확인 요청이 많습니다. 잠시 후 다시 시도해주세요.','RATE_LIMITED'); END IF;
 DELETE FROM prayer_private.import_jobs WHERE "expiresAt"<now();
 result:=prayer_private.import_rows(body,actor,false);
 IF jsonb_array_length(result->'errors')=0 THEN
  INSERT INTO prayer_private.import_jobs("sessionId",payload) VALUES(actor.id,body) RETURNING id INTO job;
 END IF;
 RETURN result||jsonb_build_object('jobId',job);
END $$;
CREATE OR REPLACE FUNCTION prayer_private.import_commit(body jsonb, actor prayer_private.sessions) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE job prayer_private.import_jobs; saved_result jsonb;
BEGIN
 SELECT * INTO job FROM prayer_private.import_jobs WHERE id=(body->>'jobId')::uuid AND "sessionId"=actor.id FOR UPDATE;
 IF job.id IS NULL OR job."expiresAt"<now() THEN PERFORM prayer_private.fail(409,'업로드 확인이 만료되었습니다. 다시 파일을 확인해주세요.'); END IF;
 IF job.result IS NOT NULL THEN RETURN job.result; END IF;
 IF prayer_private.limited('import-commit:'||actor.id,10,3600) THEN PERFORM prayer_private.fail(429,'일괄 저장은 시간당 10회까지 가능합니다.','RATE_LIMITED'); END IF;
 saved_result:=prayer_private.import_rows(job.payload,actor,true)-'rows';
 UPDATE prayer_private.import_jobs SET result=saved_result WHERE id=job.id;
 RETURN saved_result;
END $$;

CREATE OR REPLACE FUNCTION prayer_private.dispatch(action text, payload jsonb, session_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE actor prayer_private.sessions; result jsonb; old_field public.praycontentfield; old_prayer public.praycontent; asset prayer_private.assets; target uuid; details text; info jsonb; mime_value text; requested_role text;
BEGIN
 IF action='health' THEN RETURN jsonb_build_object('data',jsonb_build_object('version',4)); END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN PERFORM prayer_private.fail(400,'요청 형식을 확인해주세요.'); END IF;
 IF octet_length(payload::text)>524288 THEN PERFORM prayer_private.fail(413,'저장 요청이 512KiB를 넘습니다. 엑셀 파일을 나누거나 입력량을 줄여주세요.'); END IF;
 IF action='login' THEN RETURN prayer_private.login(payload); END IF;
 IF action IN ('cleanup_list','cleanup_ack') THEN
  IF length(session_token)<32 OR NOT EXISTS(SELECT FROM prayer_private.settings WHERE key='cron_hash' AND value=encode(sha256(convert_to(session_token,'UTF8')),'hex')) THEN PERFORM prayer_private.fail(403,'접근할 수 없습니다.'); END IF;
  IF action='cleanup_list' THEN
   UPDATE prayer_private.assets SET state='deleting' WHERE state IN ('uploading','pending') AND "expiresAt"<now();
   DELETE FROM prayer_private.import_jobs WHERE "expiresAt"<now();
   DELETE FROM prayer_private.sessions WHERE "expiresAt"<now(); DELETE FROM prayer_private.rate_limits WHERE "expiresAt"<now();
   SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) INTO result FROM (SELECT id,"objectKey" FROM prayer_private.assets WHERE state='deleting' ORDER BY "createdAt" LIMIT 50) a;
  ELSE DELETE FROM prayer_private.assets WHERE id=(payload->>'id')::uuid AND state='deleting'; result:=jsonb_build_object('ok',true); END IF;
  RETURN jsonb_build_object('data',result);
 END IF;
 actor:=prayer_private.actor(session_token);
 IF action='session' THEN RETURN jsonb_build_object('data',CASE WHEN actor.id IS NULL THEN NULL ELSE jsonb_build_object('role',actor.role,'sessionId',actor.id) END); END IF;
 IF action='logout' THEN DELETE FROM prayer_private.sessions WHERE id=actor.id; RETURN jsonb_build_object('data',jsonb_build_object('ok',true)); END IF;
 IF actor.id IS NULL AND action NOT IN ('fields','prayer','query','file','summary','export') THEN PERFORM prayer_private.fail(401,'교회 구성원 인증 후 이용해주세요.','UNAUTHORIZED'); END IF;
 IF action IN ('save_field','delete_field','password','reorder_fields') AND actor.role<>'admin' THEN PERFORM prayer_private.fail(403,'이 작업을 수행할 권한이 없습니다.','FORBIDDEN'); END IF;
 IF action IN ('delete_prayer','import_preview','import_commit') AND actor.role NOT IN ('admin','sub-admin') THEN PERFORM prayer_private.fail(403,'이 작업을 수행할 권한이 없습니다.','FORBIDDEN'); END IF;
 CASE action
 WHEN 'fields' THEN SELECT coalesce(jsonb_agg(prayer_private.field_json(f) ORDER BY "listOrder","createDateTime",id),'[]'::jsonb) INTO result FROM public.praycontentfield f;
 WHEN 'reorder_fields' THEN result:=prayer_private.reorder_fields(payload);
 WHEN 'summary' THEN result:=prayer_private.summaries(payload);
 WHEN 'export' THEN result:=prayer_private.export_snapshot(payload);
 WHEN 'import_preview' THEN result:=prayer_private.import_preview(payload,actor);
 WHEN 'import_commit' THEN result:=prayer_private.import_commit(payload,actor);
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

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA prayer_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION prayer_private.dispatch(text,jsonb,text) TO anon,authenticated;
NOTIFY pgrst, 'reload schema';
