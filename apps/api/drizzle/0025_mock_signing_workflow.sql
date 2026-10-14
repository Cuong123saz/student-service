INSERT INTO permissions(code,name,description) VALUES ('document.mock_sign','Ký mô phỏng dữ liệu giả','Chỉ thao tác trong diễn tập giả, chưa phải thẩm quyền ký thật') ON CONFLICT(code) DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION mock_signature_can_view(actor uuid, dossier_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
SELECT EXISTS(SELECT 1 FROM submissions s JOIN users u ON u.id=actor AND u.status='ACTIVE' AND NOT u.must_change_password
 WHERE s.id=dossier_id AND (
 (s.student_user_id=actor AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.code='STUDENT'
 JOIN student_profiles p ON p.user_id=ur.user_id JOIN academic_classes c ON c.id=p.class_id AND c.status='ACTIVE'
 JOIN faculties f ON f.id=c.faculty_id AND f.status='ACTIVE' WHERE ur.user_id=actor)) OR
 (s.student_user_id<>actor AND s.status IN ('SUBMITTED','IN_REVIEW','NEEDS_SUPPLEMENT','APPROVED','REJECTED')
 AND EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id
 JOIN permissions p ON p.id=rp.permission_id AND p.code='submission.review'
 JOIN user_role_scopes urs ON urs.user_id=ur.user_id AND urs.role_id=ur.role_id JOIN authorization_scopes scope ON scope.id=urs.scope_id
 JOIN organizational_units unit ON unit.id=s.processing_unit_id AND unit.status='ACTIVE'
 WHERE ur.user_id=actor AND (scope.scope_type='GLOBAL' OR (scope.scope_type='ORGANIZATION' AND scope.organizational_unit_id=s.processing_unit_id))
 AND (s.designated_reviewer_id IS NULL OR s.reviewer_user_id=actor OR (s.status='SUBMITTED' AND s.designated_reviewer_id=actor)
 OR (s.status IN ('IN_REVIEW','NEEDS_SUPPLEMENT') AND EXISTS(SELECT 1 FROM role_permissions g JOIN permissions p2 ON p2.id=g.permission_id WHERE g.role_id=ur.role_id AND p2.code='submission.assign')))))))
$$;
--> statement-breakpoint
CREATE FUNCTION mock_signature_can_sign(actor uuid, doc_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
SELECT EXISTS(SELECT 1 FROM submission_documents d JOIN submission_document_sets ds ON ds.id=d.set_id
 JOIN submission_rounds r ON r.id=ds.round_id JOIN submissions s ON s.id=ds.submission_id
 JOIN services service ON service.id=s.service_id AND service.status='ACTIVE' AND service.code<>'STUDENT_CONFIRMATION'
 JOIN users u ON u.id=actor AND u.status='ACTIVE' AND NOT u.must_change_password
 JOIN organizational_units unit ON unit.id=s.processing_unit_id AND unit.status='ACTIVE'
 JOIN user_roles ur ON ur.user_id=u.id JOIN role_permissions rp ON rp.role_id=ur.role_id
 JOIN permissions p ON p.id=rp.permission_id AND p.code='document.mock_sign'
 JOIN user_role_scopes urs ON urs.user_id=ur.user_id AND urs.role_id=ur.role_id JOIN authorization_scopes scope ON scope.id=urs.scope_id
 WHERE d.id=doc_id AND s.status='APPROVED' AND s.reviewer_user_id=actor AND s.student_user_id<>actor
 AND s.round_number=r.round_number AND ds.kind='DECLARATION' AND d.status='UNSIGNED_DECLARATION'
 AND s.procedure->>'processingMode' IN ('ONLINE','HYBRID')
 AND EXISTS(SELECT 1 FROM role_permissions g JOIN permissions p2 ON p2.id=g.permission_id WHERE g.role_id=ur.role_id AND p2.code='submission.review')
 AND (scope.scope_type='GLOBAL' OR (scope.scope_type='ORGANIZATION' AND scope.organizational_unit_id=s.processing_unit_id)))
$$;
--> statement-breakpoint
CREATE TABLE mock_signature_receipts (
 id uuid PRIMARY KEY, document_id uuid NOT NULL UNIQUE REFERENCES submission_documents(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, submission_revision integer NOT NULL CHECK(submission_revision>0),
 receipt jsonb NOT NULL, receipt_sha256 varchar(64) NOT NULL CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mock_receipt_shape CHECK((jsonb_typeof(receipt)='object'
 AND receipt ?& ARRAY['version','provider','receiptId','simulatedAt','notice','fakeDataOnly','actorId','document']
 AND receipt - 'version' - 'provider' - 'receiptId' - 'simulatedAt' - 'notice' - 'fakeDataOnly' - 'actorId' - 'document' = '{}'::jsonb
 AND receipt->'version'='1'::jsonb AND receipt->>'provider'='MOCK_SIGNATURE_V1'
 AND receipt->>'notice'='DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ' AND receipt->'fakeDataOnly'='true'::jsonb
 AND receipt->>'actorId'=actor_user_id::text AND receipt->>'receiptId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 AND jsonb_typeof(receipt->'simulatedAt')='string' AND receipt->>'simulatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
 AND jsonb_typeof(receipt->'document')='object') IS TRUE)
);
--> statement-breakpoint
CREATE TABLE mock_signature_checks (
 id uuid PRIMARY KEY, receipt_id uuid NOT NULL REFERENCES mock_signature_receipts(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mock_check_shape CHECK((jsonb_typeof(result)='object'
 AND result ?& ARRAY['outcome','reason','technicalSignatureStatus','legalEffect','notice']
 AND result - 'outcome' - 'reason' - 'technicalSignatureStatus' - 'legalEffect' - 'notice' = '{}'::jsonb
 AND result->>'technicalSignatureStatus'='NOT_VERIFIED' AND result->'legalEffect'='false'::jsonb
 AND result->>'notice'='DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ'
 AND ((result->>'outcome'='SIMULATION_MATCH' AND result->>'reason'='MATCH') OR
 (result->>'outcome'='SIMULATION_MISMATCH' AND result->>'reason' IN ('RECEIPT_INVALID','RECEIPT_CHANGED','DOCUMENT_CHANGED','BINDING_CHANGED','ACTOR_CHANGED')))) IS TRUE)
);
--> statement-breakpoint
CREATE INDEX mock_checks_receipt_time ON mock_signature_checks(receipt_id,created_at,id);
--> statement-breakpoint
CREATE FUNCTION validate_mock_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc submission_documents%ROWTYPE; DECLARE dossier submissions%ROWTYPE; DECLARE round_id uuid; DECLARE expected jsonb;
BEGIN
 SELECT d.* INTO doc FROM submission_documents d WHERE d.id=NEW.document_id;
 SELECT s.* INTO dossier FROM submissions s JOIN submission_document_sets ds ON ds.submission_id=s.id WHERE ds.id=doc.set_id;
 SELECT ds.round_id INTO round_id FROM submission_document_sets ds WHERE ds.id=doc.set_id;
 IF NOT mock_signature_can_sign(NEW.actor_user_id,NEW.document_id) THEN RAISE EXCEPTION 'MOCK_SIGN_FORBIDDEN' USING ERRCODE='42501'; END IF;
 expected:=jsonb_build_object('documentId',doc.id::text,'submissionId',dossier.id::text,'roundId',round_id::text,'format',doc.format,'size',doc.size,'sha256',doc.sha256);
 IF NEW.submission_revision<>dossier.revision OR NEW.receipt->'document' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'MOCK_SIGN_BINDING' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER mock_receipt_validate BEFORE INSERT ON mock_signature_receipts FOR EACH ROW EXECUTE FUNCTION validate_mock_receipt();
--> statement-breakpoint
CREATE FUNCTION validate_mock_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dossier_id uuid;
BEGIN
 SELECT ds.submission_id INTO dossier_id FROM mock_signature_receipts r JOIN submission_documents d ON d.id=r.document_id JOIN submission_document_sets ds ON ds.id=d.set_id WHERE r.id=NEW.receipt_id;
 IF NOT mock_signature_can_view(NEW.actor_user_id,dossier_id) THEN RAISE EXCEPTION 'MOCK_VERIFY_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER mock_check_validate BEFORE INSERT ON mock_signature_checks FOR EACH ROW EXECUTE FUNCTION validate_mock_check();
--> statement-breakpoint
CREATE FUNCTION audit_mock_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,metadata)
 SELECT 'USER',NEW.actor_user_id,u.username,CASE WHEN TG_TABLE_NAME='mock_signature_receipts' THEN 'document.mock_signed' ELSE 'document.mock_verified' END,
 'mock_signature',NEW.id::text,CASE WHEN TG_TABLE_NAME='mock_signature_checks' AND to_jsonb(NEW)->'result'->>'outcome'='SIMULATION_MISMATCH' THEN 'FAILURE' ELSE 'SUCCESS' END,jsonb_build_object('fakeDataOnly',true,'notice','DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ','legalEffect',false,
 'recordId',NEW.id,'documentId',to_jsonb(NEW)->>'document_id','receiptId',to_jsonb(NEW)->>'receipt_id','result',to_jsonb(NEW)->'result') FROM users u WHERE u.id=NEW.actor_user_id;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER mock_receipt_audit AFTER INSERT ON mock_signature_receipts FOR EACH ROW EXECUTE FUNCTION audit_mock_signature();
--> statement-breakpoint
CREATE TRIGGER mock_check_audit AFTER INSERT ON mock_signature_checks FOR EACH ROW EXECUTE FUNCTION audit_mock_signature();
--> statement-breakpoint
CREATE TRIGGER mock_receipts_immutable BEFORE UPDATE OR DELETE ON mock_signature_receipts FOR EACH ROW EXECUTE FUNCTION protect_submission_history();
--> statement-breakpoint
CREATE TRIGGER mock_checks_immutable BEFORE UPDATE OR DELETE ON mock_signature_checks FOR EACH ROW EXECUTE FUNCTION protect_submission_history();
