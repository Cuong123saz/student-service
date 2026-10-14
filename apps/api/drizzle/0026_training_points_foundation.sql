INSERT INTO permissions(code,name,description) VALUES('training_point.period.manage','Quản lý đợt điểm rèn luyện','Thiết lập và mở/đóng đợt đánh giá trong phạm vi được giao') ON CONFLICT(code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='SYSTEM_ADMIN' AND p.code='training_point.period.manage' ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION training_valid_criteria(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; DECLARE codes text:=''; DECLARE total integer:=0;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(value)<>5 THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
  IF jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['code','label','maxPoints','evidenceRequired']) OR item-'code'-'label'-'maxPoints'-'evidenceRequired'<>'{}'::jsonb OR jsonb_typeof(item->'code') IS DISTINCT FROM 'string' OR (item->>'code')!~'^[A-E]$' OR jsonb_typeof(item->'label')<>'string' OR char_length(btrim(item->>'label')) NOT BETWEEN 1 AND 200 OR jsonb_typeof(item->'maxPoints')<>'number' OR (item->>'maxPoints')!~'^[0-9]{1,3}$' OR jsonb_typeof(item->'evidenceRequired')<>'boolean' THEN RETURN false; END IF;
  IF (item->>'maxPoints')::integer NOT BETWEEN 1 AND 100 OR position(item->>'code' IN codes)>0 THEN RETURN false; END IF;
  codes:=codes||(item->>'code'); total:=total+(item->>'maxPoints')::integer;
 END LOOP;
 RETURN total=100;
END $$;
--> statement-breakpoint
CREATE FUNCTION training_valid_answers(value jsonb,criteria jsonb,complete boolean) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE pair record; DECLARE cap integer;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF complete AND (SELECT count(*) FROM jsonb_object_keys(value))<>5 THEN RETURN false; END IF;
 FOR pair IN SELECT * FROM jsonb_each(value) LOOP
  IF pair.key!~'^[A-E]$' OR jsonb_typeof(pair.value)<>'object' OR NOT(pair.value ?& ARRAY['points','note']) OR pair.value-'points'-'note'<>'{}'::jsonb OR jsonb_typeof(pair.value->'note')<>'string' OR char_length(pair.value->>'note')>2000 THEN RETURN false; END IF;
  IF pair.value->'points'='null'::jsonb THEN IF complete THEN RETURN false; END IF; CONTINUE; END IF;
  IF jsonb_typeof(pair.value->'points')<>'number' OR (pair.value->>'points')!~'^[0-9]{1,3}$' THEN RETURN false; END IF;
  SELECT (x->>'maxPoints')::integer INTO cap FROM jsonb_array_elements(criteria) x WHERE x->>'code'=pair.key;
  IF cap IS NULL OR (pair.value->>'points')::integer>cap OR (complete AND (pair.value->>'points')::integer>0 AND char_length(btrim(pair.value->>'note'))=0) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE TABLE training_periods(id uuid PRIMARY KEY,class_id uuid NOT NULL REFERENCES academic_classes(id),academic_year varchar(9) NOT NULL CHECK(academic_year ~ '^[0-9]{4}-[0-9]{4}$'),semester varchar(6) NOT NULL CHECK(semester IN ('1','2','SUMMER')),name varchar(200) NOT NULL,policy_label varchar(200) NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','OPEN','CLOSED')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),criteria jsonb NOT NULL CHECK(training_valid_criteria(criteria) IS TRUE),created_by uuid NOT NULL REFERENCES users(id),updated_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(class_id,academic_year,semester),CHECK(starts_at<ends_at));
--> statement-breakpoint
CREATE TABLE training_declarations(id uuid PRIMARY KEY,period_id uuid NOT NULL REFERENCES training_periods(id),student_user_id uuid NOT NULL REFERENCES users(id),state varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','SUBMITTED')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),answers jsonb NOT NULL DEFAULT '{}'::jsonb,student_snapshot jsonb,period_snapshot jsonb,evidence_snapshot jsonb,total_points integer CHECK(total_points BETWEEN 0 AND 100),submit_request_id uuid UNIQUE,submitted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(period_id,student_user_id),CHECK((state='DRAFT' AND student_snapshot IS NULL AND period_snapshot IS NULL AND evidence_snapshot IS NULL AND total_points IS NULL AND submit_request_id IS NULL AND submitted_at IS NULL) OR (state='SUBMITTED' AND student_snapshot IS NOT NULL AND period_snapshot IS NOT NULL AND evidence_snapshot IS NOT NULL AND total_points IS NOT NULL AND submit_request_id IS NOT NULL AND submitted_at IS NOT NULL)));
--> statement-breakpoint
CREATE TABLE training_evidence(id uuid PRIMARY KEY,declaration_id uuid NOT NULL REFERENCES training_declarations(id),criterion varchar(1) NOT NULL CHECK(criterion ~ '^[A-E]$'),storage_key uuid NOT NULL UNIQUE,name varchar(200) NOT NULL,mime_type varchar(40) NOT NULL CHECK(mime_type IN ('application/pdf','image/png','image/jpeg')),size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880),sha256 varchar(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),signature_status varchar(20) NOT NULL DEFAULT 'NOT_CHECKED' CHECK(signature_status='NOT_CHECKED'),input_revision integer NOT NULL CHECK(input_revision>0),removed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX training_evidence_parent ON training_evidence(declaration_id,id) WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE TABLE training_events(id uuid PRIMARY KEY,declaration_id uuid NOT NULL REFERENCES training_declarations(id),actor_user_id uuid NOT NULL REFERENCES users(id),action varchar(20) NOT NULL CHECK(action IN ('CREATED','SAVED','FILE_ADDED','FILE_REMOVED','SUBMITTED')),revision integer NOT NULL,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(declaration_id,revision));
--> statement-breakpoint
CREATE FUNCTION protect_training_period() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'TRAINING_PERIOD_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.status='CLOSED' OR ROW(NEW.id,NEW.class_id,NEW.academic_year,NEW.semester,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.class_id,OLD.academic_year,OLD.semester,OLD.created_by,OLD.created_at) OR NEW.revision<>OLD.revision+1 OR (OLD.status='DRAFT' AND NEW.status NOT IN ('DRAFT','OPEN')) OR (OLD.status='OPEN' AND (NEW.status<>'CLOSED' OR ROW(NEW.name,NEW.policy_label,NEW.starts_at,NEW.ends_at,NEW.criteria) IS DISTINCT FROM ROW(OLD.name,OLD.policy_label,OLD.starts_at,OLD.ends_at,OLD.criteria))) THEN RAISE EXCEPTION 'TRAINING_PERIOD_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER training_period_guard BEFORE UPDATE OR DELETE ON training_periods FOR EACH ROW EXECUTE FUNCTION protect_training_period();
--> statement-breakpoint
CREATE FUNCTION training_file_snapshot(dossier uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f.id,'criterion',f.criterion,'name',f.name,'mimeType',f.mime_type,'size',f.size,'sha256',f.sha256,'signatureStatus',f.signature_status) ORDER BY f.id),'[]'::jsonb) FROM training_evidence f WHERE f.declaration_id=dossier AND f.removed_at IS NULL $$;
--> statement-breakpoint
CREATE FUNCTION protect_training_declaration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE period training_periods%ROWTYPE; DECLARE profile jsonb; DECLARE points integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'TRAINING_DECLARATION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (OLD.state='SUBMITTED' OR ROW(NEW.id,NEW.period_id,NEW.student_user_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.period_id,OLD.student_user_id,OLD.created_at) OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'TRAINING_DECLARATION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT * INTO period FROM training_periods WHERE id=NEW.period_id FOR SHARE;
 SELECT jsonb_build_object('fullName',u.full_name,'studentCode',s.student_code,'classCode',c.code,'facultyCode',f.code) INTO profile FROM users u JOIN student_profiles s ON s.user_id=u.id JOIN academic_classes c ON c.id=s.class_id JOIN faculties f ON f.id=c.faculty_id WHERE u.id=NEW.student_user_id AND u.status='ACTIVE' AND NOT u.must_change_password AND c.id=period.class_id AND c.status='ACTIVE' AND f.status='ACTIVE' AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='STUDENT');
 IF profile IS NULL OR period.status<>'OPEN' OR clock_timestamp()<period.starts_at OR clock_timestamp()>=period.ends_at OR training_valid_answers(NEW.answers,period.criteria,NEW.state='SUBMITTED') IS NOT TRUE THEN RAISE EXCEPTION 'TRAINING_DECLARATION_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.state<>'DRAFT' OR NEW.revision<>1) THEN RAISE EXCEPTION 'TRAINING_DECLARATION_INVALID' USING ERRCODE='23514'; END IF;
 IF NEW.state='SUBMITTED' THEN
  SELECT sum((v->>'points')::integer) INTO points FROM jsonb_each(NEW.answers) a(k,v);
  IF NEW.total_points<>points OR NEW.student_snapshot IS DISTINCT FROM profile OR NEW.period_snapshot IS DISTINCT FROM jsonb_build_object('name',period.name,'academicYear',period.academic_year,'semester',period.semester,'policyLabel',period.policy_label,'criteria',period.criteria) OR NEW.evidence_snapshot IS DISTINCT FROM training_file_snapshot(NEW.id) OR EXISTS(SELECT 1 FROM jsonb_array_elements(period.criteria) c WHERE (c->>'evidenceRequired')::boolean AND (NEW.answers->(c->>'code')->>'points')::integer>0 AND NOT EXISTS(SELECT 1 FROM training_evidence e WHERE e.declaration_id=NEW.id AND e.criterion=c->>'code' AND e.removed_at IS NULL)) THEN RAISE EXCEPTION 'TRAINING_SNAPSHOT_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER training_declaration_guard BEFORE INSERT OR UPDATE OR DELETE ON training_declarations FOR EACH ROW EXECUTE FUNCTION protect_training_declaration();
--> statement-breakpoint
CREATE FUNCTION protect_training_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE dossier training_declarations%ROWTYPE; DECLARE period training_periods%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'TRAINING_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT * INTO dossier FROM training_declarations WHERE id=NEW.declaration_id FOR UPDATE;
 SELECT * INTO period FROM training_periods WHERE id=dossier.period_id;
 IF dossier.state<>'DRAFT' OR period.status<>'OPEN' OR clock_timestamp()<period.starts_at OR clock_timestamp()>=period.ends_at THEN RAISE EXCEPTION 'TRAINING_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL OR to_jsonb(NEW)-'removed_at' IS DISTINCT FROM to_jsonb(OLD)-'removed_at') THEN RAISE EXCEPTION 'TRAINING_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.input_revision<>dossier.revision OR (SELECT count(*) FROM training_evidence WHERE declaration_id=NEW.declaration_id AND removed_at IS NULL)>=10 OR (SELECT count(*) FROM training_evidence WHERE declaration_id=NEW.declaration_id AND criterion=NEW.criterion AND removed_at IS NULL)>=3 OR COALESCE((SELECT sum(size) FROM training_evidence WHERE declaration_id=NEW.declaration_id AND removed_at IS NULL),0)+NEW.size>20971520) THEN RAISE EXCEPTION 'TRAINING_EVIDENCE_LIMIT' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER training_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON training_evidence FOR EACH ROW EXECUTE FUNCTION protect_training_evidence();
--> statement-breakpoint
CREATE TRIGGER training_events_immutable BEFORE UPDATE OR DELETE ON training_events FOR EACH ROW EXECUTE FUNCTION protect_submission_history();

--> statement-breakpoint
CREATE FUNCTION training_can_manage(actor uuid, clazz uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id AND p.code='training_point.period.manage' JOIN user_role_scopes urs ON urs.user_id=ur.user_id AND urs.role_id=ur.role_id JOIN authorization_scopes scope ON scope.id=urs.scope_id JOIN academic_classes c ON c.id=clazz AND c.status='ACTIVE' JOIN faculties f ON f.id=c.faculty_id AND f.status='ACTIVE' WHERE u.id=actor AND u.status='ACTIVE' AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM user_roles admin JOIN roles role ON role.id=admin.role_id WHERE admin.user_id=u.id AND role.code IN ('ADMIN','SYSTEM_ADMIN')) AND (scope.scope_type='GLOBAL' OR scope.scope_type='FACULTY' AND scope.faculty_id=c.faculty_id OR scope.scope_type='CLASS' AND scope.class_id=c.id))
$$;
