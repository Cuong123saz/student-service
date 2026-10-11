# Registry và lease tài liệu — phần nền tảng B2

Cập nhật 11/10/2026 theo [ADR0009](adr/0009-immutable-generated-documents.md) và [ADR0010](adr/0010-document-vault-and-recovery.md), cả hai đã commit Accepted trước migration0023. Đã có schema/repository và kiểm chứng SQL. Chưa nối registry vào route tải, chưa lưu byte Word/PDF bằng cơ chế này, chưa triển khai worker/vault hay ký. Không tự đóng Sprint4.

## Dữ liệu được bảo vệ

Migration0023 chỉ thêm ba bảng, index, constraint và trigger, không backfill hoặc sửa hồ sơ cũ:

- submission_document_sets giữ bộ DECLARATION của một round; FK ghép về round/submission, unique round/kind, binding mẫu phải bằng đúng binding trong round. Append-only.
- submission_documents giữ metadata mỗi DOCX/PDF, UUID storage key bằng UUID attempt, size1–16MiB, SHA-256, binding và provenance. Unique bộ/định dạng và storage key. Trạng thái chỉ UNSIGNED_DECLARATION. Không update/delete. Word không có converter/source hash; PDF bắt buộc converter và nguồn Word đúng bản đã công bố cùng renderer. Các CHECK dùng IS TRUE để SQLNULL không lọt qua điều kiện JSON/hash.
- submission_document_jobs giữ trạng thái PENDING/RUNNING/RETRYABLE/COMPLETE và lease. Job bắt đầu PENDING; binding/id/thời điểm tạo cố định; COMPLETE không sửa/xóa được. Foreign key ghép buộc tài liệu COMPLETE đúng bộ/định dạng. Trigger chặn tự kéo dài lease, reset số lần, tái sử dụng token hoặc nhảy trạng thái không hợp lệ.

Provenance Word yêu cầu version/buildSha256/Node/ICU; PDF thêm version/binarySha256 của converter và sourceDocxSha256. Đây là cấu trúc metadata bắt buộc, chưa phải cơ chế thu thập/kiểm chứng build runtime hoàn chỉnh. Test dùng metadata giả rõ ràng, không giả danh binary đã ký.

## Nhận việc và công bố

Repository dùng advisory transaction lock chung khi claim, khóa bộ rồi job, đọc thời gian PostgreSQL. Tối đa hai lease còn hiệu lực giữa các instance cùng dùng repository; không giữ transaction qua render, converter hoặc I/O tệp. Đây là quota job phối hợp qua database, không chứng minh tổng số tiến trình converter vật lý: worker cũ bị treo rồi chạy tiếp vẫn cần supervisor/timeout khi triển khai vault.

Lease mặc định180 giây, giới hạn1–180 giây; test dùng1/10 giây. Token mới mỗi lần nhận việc. Retry mặc định đợi3 giây và tối đa3 attempt; có trả BUSY, RETRY_LATER, WORD_REQUIRED và EXHAUSTED, không loop vô hạn trong request. Cần thêm đường vận hành retry sau khi đã khắc phục lỗi trước khi bật tính năng; hiện không có endpoint quản trị tự reset job đã hết lượt.

Công bố kiểm tra job ID/token/bộ/định dạng, rồi insert metadata trong transaction ngắn. Trigger kiểm tra lease vẫn hiện hành, binding mẫu và PDF-source-Word; chuyển job COMPLETE và ghi audit kỹ thuật trong cùng transaction. Lỗi audit làm cả tài liệu và COMPLETE rollback. Tác vụ cũ không thể fail hoặc publish lease thay thế. Đã có tài liệu thì claim trả READY, không nhận việc lại.

Audit là SYSTEM với UUID/hash/version/code, không câu trả lời hoặc quyết định xét hồ sơ. document.published nghĩa là metadata phiếu kê khai được công bố nội bộ; không có nghĩa phát hành kết quả chính thức. Duyệt nội dung, phát hành và chữ ký vẫn tách riêng.

Repository là hạ tầng nội bộ, chưa là route có quyền truy cập. Service nối vào sau phải giữ kiểm tra owner/reviewer/admin trước thao tác và lần nữa trước trả byte, không đưa storage key hoặc provenance kỹ thuật vào flow sinh viên.

## Kiểm chứng

15 test (14 tình huống trong một test chính) chạy trong database tạm document_registry_test_<UUID> riêng trên cluster test5434; xác minh tên database trước TRUNCATE và chỉ drop chính database vừa tạo. Fixture dùng client raw riêng vì Drizzle thay serializer JSON. So sánh toàn bộ hàng của26 bảng cũ trước/sau migration0023; hồ sơ/round/audit/notification/quyền không bị viết lại.

Đã thử set/claim đồng thời, claim lại READY, metadata append-only, PDF chưa có Word/sai nguồn/sai renderer/mẫu, lease hết hạn khi chưa có và khi đã có lease mới, job ID sai, tự kéo dài lease, insert job RUNNING giả, SQLNULL/JSONNULL/provenance sai, quota2 job giữa hai instance, retry/backoff/giới hạn attempt, audit lỗi rollback và binding mẫu giả. Đây là hai instance repository trong một tiến trình với pool SQL; chưa phải thử hai process/hai máy hoặc kill process giữa ghi file/công bố. Claim lại sau commit trả cùng metadata; chưa mô phỏng mất HTTP response trên đường mạng.

Hồi quy API: 128 unit đạt, một unit symlink Windows bỏ qua do EPERM; 279 integration, 22 storage, 20 fixture, 170 recovery/archive/encryption, 6 rào chắn demo và7 verifier đạt. Typecheck/lint/build, format và schema drift check đạt. Test concurrency guard cùng asset recovery guard đạt49 ca. Không bỏ qua lint hoặc tắt ràng buộc để làm xanh kiểm thử.

Lượt phục hồi 056c3f7f-aeff-409c-956c-f56f9f318bc0 đạt với29 bảng/4 sequence và registry rỗng: schema, index, constraint và trigger mới được giữ qua dump/restore vào cluster mới. Không coi đó là chứng minh phục hồi tài liệu đã công bố. Backup fixture v1/v2 giờ từ chối nếu một trong ba bảng registry có hàng; tránh sao lưu metadata mà bỏ byte hoặc trạng thái lease. B2 đầy đủ phải thay guard bằng snapshot registry và inventory vault thật.

Bằng chứng local bị Git bỏ qua: run/document-registry-final-test.log, run/document-registry-api-regression.log, run/document-registry-lint-final.log, run/document-registry-typecheck-checked.log, run/document-registry-build-final.log, run/document-registry-schema-drift.log, run/document-registry-operational-guards.log và run/document-registry-empty-recovery.log. Một số lượt đầu lỗi thứ tự FK/index, serializer fixture hoặc kiểm tra kiểu; các log lỗi được giữ, chỉ lượt đã sửa đạt mới là bằng chứng.

## Điểm tiếp tục

Nối vault riêng với staging/ghi độc quyền/fsync, kiểm chứng cấu trúc/size/hash, giữ orphan khi commit không rõ kết quả. Thu provenance từ build/converter thật; lưu Word trước, PDF chuyển từ đúng byte Word. Thử hai process, kill trước/sau ghi file/commit, mất phản hồi và thu quyền khi tạo. Mở route trên demo mới sau khi audit/backup/restore từ registry có dữ liệu đạt; sau đó mới nâng DB development có sao lưu/đối chiếu. Database5433 và các demo3011/3013/3015 chưa áp migration0023, runtime cũ giữ nguyên.
