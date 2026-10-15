CREATE FUNCTION training_review_allowed(actor uuid,clazz uuid,stage text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions pm ON pm.id=rp.permission_id JOIN user_role_scopes urs ON urs.user_id=u.id AND urs.role_id=r.id JOIN authorization_scopes s ON s.id=urs.scope_id JOIN academic_classes c ON c.id=clazz AND c.status='ACTIVE' JOIN faculties f ON f.id=c.faculty_id AND f.status='ACTIVE'
 WHERE u.id=actor AND u.status='ACTIVE' AND NOT u.must_change_password
 AND ((stage='ADVISOR' AND r.code='ACADEMIC_ADVISOR' AND pm.code='training_point.review' AND (s.scope_type='GLOBAL' OR (s.scope_type='CLASS' AND s.class_id=c.id) OR (s.scope_type='FACULTY' AND s.faculty_id=c.faculty_id)) AND EXISTS(SELECT 1 FROM academic_advisor_assignments a WHERE a.advisor_user_id=u.id AND a.class_id=c.id AND a.status='ACTIVE' AND a.valid_from<=clock_timestamp() AND (a.valid_to IS NULL OR a.valid_to>clock_timestamp())))
 OR (stage='FACULTY' AND r.code='FACULTY_REVIEWER' AND pm.code='training_point.faculty_approve' AND (s.scope_type='GLOBAL' OR (s.scope_type='FACULTY' AND s.faculty_id=c.faculty_id))))) $$;
--> statement-breakpoint
CREATE FUNCTION training_declaration_hash(dossier uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('id',d.id,'periodId',d.period_id,'studentUserId',d.student_user_id,'answers',d.answers,'student',d.student_snapshot,'period',d.period_snapshot,'evidence',d.evidence_snapshot,'totalPoints',d.total_points,'submittedAt',to_char(d.submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex') FROM training_declarations d WHERE d.id=dossier AND d.state='SUBMITTED' $$;
--> statement-breakpoint
CREATE TABLE training_review_decisions(
 id uuid PRIMARY KEY,declaration_id uuid NOT NULL REFERENCES training_declarations(id),revision integer NOT NULL CHECK(revision>0),
 action varchar(20) NOT NULL CHECK(action IN ('ADVISOR_SIGNED','FACULTY_RETURNED','FACULTY_APPROVED')),actor_user_id uuid NOT NULL REFERENCES users(id),actor_snapshot jsonb NOT NULL,
 assessed_answers jsonb NOT NULL,total_points integer NOT NULL CHECK(total_points BETWEEN 0 AND 100),comment varchar(2000) NOT NULL CHECK(char_length(btrim(comment)) BETWEEN 1 AND 2000),
 declaration_sha256 varchar(64) NOT NULL CHECK(declaration_sha256 ~ '^[a-f0-9]{64}$'),parent_decision_id uuid REFERENCES training_review_decisions(id),request_id uuid NOT NULL UNIQUE,input_revision integer NOT NULL CHECK(input_revision>=0),payload jsonb NOT NULL,payload_sha256 varchar(64) NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(declaration_id,revision));
--> statement-breakpoint
CREATE INDEX training_review_latest ON training_review_decisions(declaration_id,revision DESC);
--> statement-breakpoint
CREATE INDEX training_review_period_queue ON training_declarations(period_id,id) WHERE state='SUBMITTED';
--> statement-breakpoint
CREATE FUNCTION protect_training_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d training_declarations%ROWTYPE; p training_periods%ROWTYPE; prev training_review_decisions%ROWTYPE; actor jsonb; expected jsonb; stage text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'TRAINING_REVIEW_IMMUTABLE' USING ERRCODE='23514'; END IF;
 LOCK TABLE users,roles,user_roles,role_permissions,permissions,user_role_scopes,authorization_scopes,student_profiles,academic_classes,faculties,academic_advisor_assignments IN SHARE MODE;
 SELECT * INTO d FROM training_declarations WHERE id=NEW.declaration_id;
 SELECT * INTO p FROM training_periods WHERE id=d.period_id FOR UPDATE;
 SELECT * INTO d FROM training_declarations WHERE id=NEW.declaration_id FOR UPDATE;
 SELECT * INTO prev FROM training_review_decisions WHERE declaration_id=d.id ORDER BY revision DESC LIMIT 1;
 stage:=CASE WHEN NEW.action='ADVISOR_SIGNED' THEN 'ADVISOR' ELSE 'FACULTY' END;
 IF d.state IS DISTINCT FROM 'SUBMITTED' OR NEW.actor_user_id=d.student_user_id OR training_review_allowed(NEW.actor_user_id,p.class_id,stage) IS NOT TRUE OR NEW.input_revision<>COALESCE(prev.revision,0) OR NEW.revision<>NEW.input_revision+1 OR NEW.declaration_sha256 IS DISTINCT FROM training_declaration_hash(d.id) OR training_valid_answers(NEW.assessed_answers,d.period_snapshot->'criteria',true) IS NOT TRUE OR NEW.total_points IS DISTINCT FROM (SELECT sum((v->>'points')::integer) FROM jsonb_each(NEW.assessed_answers) a(k,v)) THEN RAISE EXCEPTION 'TRAINING_REVIEW_INVALID' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(d.period_snapshot->'criteria') c WHERE (c->>'evidenceRequired')::boolean AND (NEW.assessed_answers->(c->>'code')->>'points')::integer>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d.evidence_snapshot) f WHERE f->>'criterion'=c->>'code')) THEN RAISE EXCEPTION 'TRAINING_REVIEW_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 IF stage='ADVISOR' THEN
  IF (prev.id IS NOT NULL AND prev.action<>'FACULTY_RETURNED') OR NEW.parent_decision_id IS NOT NULL OR EXISTS(SELECT 1 FROM jsonb_each(NEW.assessed_answers) a(k,v) WHERE v->'points' IS DISTINCT FROM d.answers->k->'points' AND char_length(btrim(v->>'note'))=0) THEN RAISE EXCEPTION 'TRAINING_REVIEW_TRANSITION' USING ERRCODE='23514'; END IF;
 ELSE
  IF prev.action IS DISTINCT FROM 'ADVISOR_SIGNED' OR NEW.parent_decision_id IS DISTINCT FROM prev.id OR NEW.actor_user_id=prev.actor_user_id OR NEW.assessed_answers IS DISTINCT FROM prev.assessed_answers OR NEW.total_points<>prev.total_points THEN RAISE EXCEPTION 'TRAINING_REVIEW_TRANSITION' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT jsonb_build_object('userId',u.id,'username',u.username,'fullName',u.full_name,'roleCode',CASE WHEN stage='ADVISOR' THEN 'ACADEMIC_ADVISOR' ELSE 'FACULTY_REVIEWER' END) INTO actor FROM users u WHERE u.id=NEW.actor_user_id;
 expected:=jsonb_build_object('declarationId',NEW.declaration_id,'revision',NEW.revision,'action',NEW.action,'actor',NEW.actor_snapshot,'assessedAnswers',NEW.assessed_answers,'totalPoints',NEW.total_points,'comment',NEW.comment,'declarationSha256',NEW.declaration_sha256,'parentDecisionId',NEW.parent_decision_id,'requestId',NEW.request_id,'inputRevision',NEW.input_revision,'confirmedAt',to_char(NEW.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 IF NEW.actor_snapshot IS DISTINCT FROM actor OR NEW.payload IS DISTINCT FROM expected OR NEW.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(NEW.payload::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'TRAINING_REVIEW_SNAPSHOT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER training_review_guard BEFORE INSERT OR UPDATE OR DELETE ON training_review_decisions FOR EACH ROW EXECUTE FUNCTION protect_training_review();
