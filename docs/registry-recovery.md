# Phục hồi registry và kho Word/PDF — B2 đang thực hiện

Cập nhật 11/10/2026 theo [ADR0010](adr/0010-document-vault-and-recovery.md). Đã diễn tập với database thật, tài liệu thật chứa dữ liệu giả, archive mã hóa riêng trên D và cluster PostgreSQL mới sau khi bỏ nguồn. Chưa bật vault mặc định ở development hoặc các demo đang thực hành; chưa kết luận xong B2/Sprint4.

## Hai nguồn metadata của recovery v2

Giữ đọc v1 và v2 TECHNICAL_FIXTURE cũ. V1/fixture-v2 vẫn từ chối registry có bất kỳ hàng nào, vì không đủ khôi phục output/lease. Không đổi fixture thành chứng cứ registry thật.

V2 DATABASE_REGISTRY lấy metadata từ các bảng round/set/document/job trên cùng nguồn database đã dừng writer và chuyển read-only. Thêm registrySnapshotSha256 của projection metadata kỹ thuật có thứ tự ổn định; documentId/attemptId/renderer/converter đầy đủ trong từng output; storage key phải bằng attempt. Metadata không chứa câu trả lời, cookie, thông tin kết nối hoặc path máy. Digest là đối chiếu nội dung snapshot, không chứng minh nguồn gốc hoặc chữ ký.

Layout thực có database.dump, manifest.json và bốn namespace ngang hàng: files, templates, documents, staging. Mỗi stage phải khớp key/documentId/size/hash một tài liệu đã công bố. Stage đã đối soát vẫn được mang đầy đủ, không tự xóa. Stage hoặc final không có tham chiếu/không khớp thì từ chối bản sao lưu sạch. Chưa có giao thức quarantine/cleanup cho orphan; phải xử lý vận hành riêng, không bỏ qua khi sao lưu.

Giữ giới hạn: evidence5MiB, template1MiB, document/stage16MiB, dump512MiB, manifest2MiB và encrypted metadata4MiB. Tối đa32 mẫu, 5.000 round/set/document/stage và10.000 job trong projection hiện tại; gặp vượt giới hạn thì từ chối, không âm thầm cắt dữ liệu. Giới hạn manifest áp dụng thêm, không cam kết mọi tập5.000 bản đều vừa. Mỗi entry mã hóa vẫn ràng buộc tên namespace; thay ciphertext final vào stage bị từ chối dù plaintext giống nhau. Reader cũ có thể từ chối source DATABASE_REGISTRY mới; reader mới vẫn nhận bản v1/v2 cũ.

## Inventory, freeze và phục hồi

Collector đối chiếu round/set/binding, document/format/attempt/provenance, job COMPLETE đúng tài liệu, PDF-source-Word cùng renderer, đủ mẫu cho mọi round, toàn bộ final và staging. Quét chỉ đọc, từ chối symlink/junction/thiếu/thừa/size/hash sai và nguồn đổi. Hash dùng handle mở không theo link, lstat/fstat cùng inode, buffer64KiB, giới hạn N+1 và kiểm tra cuối. Không cấp phát bộ đệm theo dung lượng dump hoặc file bất thường.

Creator registry bắt buộc callback đọc snapshot thật, chạy trước/sau copy và dump, so sánh metadata và inventory, cùng assertQuiescent trước/sau. Orchestrator dừng API/worker, giữ source DB read-only và không có session khác. Manifest hoàn tất ghi cuối. Đây là chế độ diễn tập giả được kiểm soát, không phải một CLI backup production mở cho nguồn bất kỳ.

Archive thường và mã hóa đều giữ stage. Giải mã xác thực mọi entry trước tạo plaintext. Restore yêu cầu bốn root mới, tuyệt đối, tách biệt; kiểm tra tất cả đích trước tạo bất kỳ root nào, không ghi đè nguồn. Dump restore vào database trống/cluster mới, so sánh toàn bộ bảng/sequence/schema/trigger và digest registry trước chuẩn bị lease.

Job RUNNING phục hồi không được giả COMPLETE. Hàm invalidateRestoredDocumentLeases chỉ nhận database target của bài diễn tập ở cổng riêng, kiểm tra đúng database/không session khác trước API mới. Transaction khóa set rồi job, chuyển RUNNING sang RETRYABLE/LEASE_EXPIRED với backoff3 giây và giữ attempt/attempts; trigger ghi lỗi kỹ thuật cùng audit document.recovery.lease.invalidated. Lỗi audit rollback toàn bộ trạng thái; gọi lại khi không còn RUNNING không tạo thay đổi. Tác vụ cũ bị từ chối công bố. Đây chưa phải lệnh vận hành cho database thật hoặc cách reset job hết3 lượt.

Sau chuẩn bị, API riêng được inject StoredSubmissionDocumentRenderer qua dependency injection hiện có. Nó đọc template/vault đã khôi phục, không đọc kho source. Owner/reviewer/admin tải đúng size/hash của từng Word/PDF đã lưu; ZIP round2 chứa đúng cặp đó và verifier đạt. Người khác/ngoài scope bị404; người không có quyền vào cổng admin bị403. PDF round1 bị gián đoạn trước tạo file đã được claim lại sau backoff, attempt2, chuyển từ Word round1 đã lưu và không thay Word.

## Cách diễn tập và audit chỉ đọc

Đã có npm run rehearse:registry-recovery --workspace @student-service/api: chạy recovery tests/build rồi chế độ --fake-data-only --document-registry. Cấu hình LIBREOFFICE_PATH tuyệt đối tới converter thực. Chọn archive qua --archive-root tuyệt đối và key giả đã tạo qua --encryption-key. Không truyền DATABASE_URL/SUBMISSION_STORAGE_ROOT/APP_ENV=production bên ngoài. Bài diễn tập tạo cluster tmpfs/cổng ngẫu nhiên, không dùng5433/5434, không reset demo3011/3013/3015. Kho vault giả riêng trên D theo UUID bài chạy; archive/key ngoài dự án, key tách khỏi archive và Git.

Audit CLI: npm run audit:documents --workspace @student-service/api. Chỉ hỗ trợ database development5433/student_service hoặc test5434/student_service_test như công cụ evidence hiện có; yêu cầu SUBMISSION_STORAGE_ROOT và ba biến absolute SUBMISSION_DOCUMENT_ROOT, SUBMISSION_DOCUMENT_STAGING_ROOT, SUBMISSION_DOCUMENT_TEMPLATE_ROOT. Không mặc định tạo kho, không nhận --repair hoặc xóa/sửa dữ liệu. Transaction repeatable-read/read-only; báo consistentBackup=false vì chưa freeze filesystem/writer. Output báo counts/hash/code, không xuất assets hoặc lỗi driver có credential/path. Development chưa cấu hình kho mới thì CLI từ chối trước kết nối.

## Bằng chứng

Lượt cuối d8aabaca-f314-43a4-be43-0c59d571a02e PASS, cleanup=true cho API/connection/container riêng. Giữ file giả/báo cáo để đối chiếu. 29 bảng, 4 sequence khớp trước/sau restore; 1 template, 3 output và3 stage tại backup, thêm PDF thứ4 sau khi tác vụ bị gián đoạn chạy tiếp. 68 HTTP request gồm từ chối dự kiến và lỗi503 của phép thử rollback nghiệp vụ; không coi mọi request là200. Các kiểm tra registry snapshot, audit-failure rollback, thu lease trước API, token cũ bị từ chối, tải qua ba portal và ZIP cùng byte đều đạt. Source cluster bị loại bỏ trước giải mã/khôi phục vào cluster khác cùng image ID; archive mã hóa ở D, chưa phải thiết bị ngoài máy.

Lượt05beb09d-4615-494d-9479-9c9a96a93cf0 PASS trước bổ sung audit-failure và chạy tiếp PDF. Lượt1c9fd77e-53d5-42dd-98cf-d5cf884bd817 đã khôi phục dữ liệu nhưng test kỳ vọng404 cho người không có ADMIN; API đúng trả403 nên lượt đó FAILED. Đã sửa kỳ vọng của bài thử, không nới quyền, không dùng log lỗi làm chứng cứ đạt.

Hồi quy mới: 20 fixture, 205 recovery/archive/encryption (gồm35 ca inventory/registry/CLI mới), 6 demo guard đạt, không skip. Typecheck/lint/build và format root/scripts đạt. Bao phủ registry metadata/provenance/stage sai, source đổi trong dump, orphan/thiếu/hỏng/template thiếu, root/đích không an toàn, archive thường/mã hóa, ciphertext đổi namespace, row limit và CLI không lộ credential. Hồi quy API143 unit/1 skip Windows +292 integration đã đạt ở lượt vault trước; lượt này không đổi code TypeScript API hoặc migration.

Hai Word và hai PDF cuối đã đối chiếu size/hash, đọc PDF pypdf strict và xem toàn bộ bốn trang render: mỗi bản một trang, đủ sáu kiểu/10 trường,0/15, Không/Có, ngày/nhãn select đúng, tiếng Việt rõ, footer chưa ký, không cắt chữ. QA run/document-qa/registry-recovery-final và run/registry-recovery-qa.json.

Log bị Git bỏ qua: run/registry-recovery-contract-complete.log, run/registry-recovery-real-final.log, run/registry-recovery-typecheck.log, run/registry-recovery-lint.log, run/registry-recovery-build.log, run/registry-recovery-format.log, run/registry-recovery-scripts-format.log. Báo cáo run/recovery-drills/<UUID>/report.json; archive trong D:\student-service-document-recovery-encrypted-fake-20261011. Không commit key, dump, cookie hoặc dữ liệu giả vào mã nguồn.

## Việc tiếp theo

Cần retry vận hành có audit sau khi khắc phục lỗi khi job đã hết3 attempt; kiểm chứng supervisor/kill converter thực, rồi mở demo vault mới và nâng development bằng backup/đối chiếu. Route mặc định hiện vẫn renderer tạm cũ. B3 đo TCP với gói lớn/nhiều worker, backup trên thiết bị khác, retention thực tế, AV và UAT còn thiếu. Mock signer chỉ sau nền tảng lưu byte; không tự gán thẩm quyền ký hoặc coi duyệt là phát hành. STUDENT_CONFIRMATION tiếp tục OFFLINE tại CTSV.
