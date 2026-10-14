---
status: Accepted
date: 2026-10-14
scope: Sprint 7 MVP, isolated synthetic data only
---

# ADR 0018: Luồng ký mô phỏng sau duyệt nội dung

Sprint 6 CLOSED local, audit PASS và hash bằng chứng còn khớp, đủ điều kiện tiếp Sprint 7 theo yêu cầu chủ dự án. Spike ADR0014 chưa phải workflow. Phát triển MVP với task ký một bước, hash, receipt, verify và audit qua HTTP/UI thật. Chỉ bật bằng dependency injection trên profile sprint7 giả riêng; server mặc định không bật. Giữ STUDENT_CONFIRMATION OFFLINE, APPROVED và mọi minh chứng NOT_CHECKED.

Bước mô phỏng sau APPROVED giao cho đúng cán bộ đang nhận xử lý, có permission document.mock_sign và submission.review cùng role/scope đang hiệu lực. Permission mới chỉ vào catalog, không tự cấp cho ADMIN/SYSTEM_ADMIN hoặc reviewer. Đây là phân công giả của MVP một bước; không suy ra thẩm quyền ký thật. Chỉ ký bản DOCX/PDF đã lưu bất biến của round hiện tại, service/unit/actor hoạt động, không tự xét/ký hồ sơ của mình. Chưa có bản lưu thì yêu cầu tải Word/PDF trước; không ký byte tái sinh theo yêu cầu.

Thêm mock_signature_receipts và mock_signature_checks append-only, FK document/round, unique document và requestId. Receipt giữ provider/notice/fake flag, actor, binding, SHA-256 pin và revision đã duyệt; đối chiếu lại metadata với document thật. Verify đọc receipt/pin tin cậy và byte kho, không nhận receipt/hash/path từ client. Chủ hồ sơ hoặc reviewer đang có quyền xem được đối chiếu và xem lịch sử; không được ký nếu thiếu quyền riêng. SIMULATION_MATCH vẫn NOT_VERIFIED/legalEffect=false; lỗi nguyên vẹn tệp thành SIMULATION_MISMATCH, không sửa tệp gốc.

Kiểm tra quyền trước và sau I/O. Transaction cuối khóa trạng thái quyền và hồ sơ, kiểm lại phân công/revision/round/document trước ghi. Không giữ transaction khi đọc file hoặc gọi provider. Request lặp đúng binding trả cùng receipt/check; tái dùng requestId cho mục tiêu khác trả409; unique document chống hai yêu cầu ký đua nhau. Trigger kiểm tra binding/shape, cấm update/delete và ghi audit metadata tối thiểu cùng transaction; lỗi audit rollback toàn thao tác. Lịch sử riêng không đổi trạng thái xét hồ sơ/tệp/Word/PDF.

UI dùng panel trong mục tài liệu, nhãn DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ, xác nhận rõ trước ký, chỉ cho nút theo quyền/bản lưu. Hiển thị kết quả đối chiếu bằng lời, không badge “chữ ký hợp lệ”. Xóa trạng thái khi đổi hồ sơ/round/portal/mất phiên; phản hồi cũ không ghi đè. Không đưa đường dẫn kho hoặc metadata triển khai vào UI.

Profile sprint7 .12:3032/3033, PostgreSQL tmpfs và vault/seed converter riêng theo ADR0015/0017, cần parent IPC, từ chối config nguồn/production. Dùng dữ liệu giả; kiểm tra HTTP/UI, phân quyền, thu hồi quyền giữa I/O, snapshot nguồn không đổi, idempotency/concurrency, append-only/audit rollback, tamper, portal và responsive. Không nâng nguồn development legacy, không ký/phát hành thật. Backup chứa receipt/check mới cần cập nhật recovery ở increment vận hành riêng trước dữ liệu thật; không coi recovery v2 cũ đã bảo vệ schema mới.
