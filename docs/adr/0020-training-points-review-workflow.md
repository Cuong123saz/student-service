---
status: Accepted
date: 2026-10-15
scope: Sprint 9 advisor/faculty workflow, synthetic local acceptance
---

# ADR 0020 — Xét duyệt điểm rèn luyện

Chủ dự án yêu cầu triển khai Sprint 9 sau Sprint 8 CLOSED local. Roadmap: cố vấn ký từng bản, khoa duyệt, tổng hợp cấp lớp. Không sửa điểm tự kê khai hoặc snapshot đã nộp; kết quả xét duyệt lưu riêng. Quy chế A–E vẫn giả định. Xác nhận nghiệp vụ bằng tài khoản, thời gian và SHA-256 không được mô tả là chữ ký số đã xác minh hoặc có hiệu lực pháp lý.

Thêm bảng append-only training_review_decisions: declaration, revision tuần tự từ 1, action ADVISOR_SIGNED/FACULTY_RETURNED/FACULTY_APPROVED, actor snapshot, assessed answers/total, comment, original declaration SHA-256, parent advisor decision, payload SHA-256, requestId và input revision. Trạng thái suy từ quyết định cuối: chưa có → WAITING_ADVISOR; advisor signed → WAITING_FACULTY; faculty returned → RETURNED_TO_ADVISOR; faculty approved → APPROVED và kết thúc. Khoa chỉ duyệt hoặc trả về cố vấn; cố vấn lập xác nhận mới sau khi bị trả. Không sửa/xóa quyết định cũ hoặc mở lại kết quả APPROVED trong Sprint 9. Student declaration vẫn SUBMITTED bất biến, không mở sửa. Faculty không sửa điểm trực tiếp. Điểm xét duyệt dương ở nhóm bắt buộc minh chứng phải có minh chứng của nhóm đó trong snapshot đã nộp; không tăng điểm để bỏ qua yêu cầu minh chứng.

Cố vấn cần role ACADEMIC_ADVISOR hiện tại, permission training_point.review trên chính role đó, scope GLOBAL/FACULTY/CLASS phù hợp và phân công lớp ACTIVE có hiệu lực tại giờ máy chủ. Khoa cần role FACULTY_REVIEWER hiện tại, permission training_point.faculty_approve trên cùng role, scope FACULTY hoặc GLOBAL phù hợp khoa hiện tại của lớp. SYSTEM_ADMIN không tự thay hai vai trò nghiệp vụ. User, lớp và khoa phải ACTIVE, tài khoản không buộc đổi mật khẩu. Không tự duyệt bản của mình; người duyệt khoa không được là người xác nhận cố vấn của vòng hiện tại, kể cả có hai role.

Quyền xét theo lớp của đợt đã nộp, không chuyển hồ sơ cũ theo lớp mới của sinh viên. Thu hồi role/permission/scope/phân công, hết hiệu lực hoặc đổi khoa lớp phải có hiệu lực ngay. Sinh viên ACTIVE còn hồ sơ hợp lệ xem kết quả của chính mình; người xử lý chỉ đọc bản SUBMITTED thuộc scope, không đọc bản nháp. Tổng hợp cấp lớp tính trên bản đã nộp: số chờ cố vấn/chờ khoa/trả về/đã duyệt, tổng/trung bình điểm được khoa duyệt. Không suy xếp loại hoặc điểm chính thức của cơ quan từ quy chế giả. Không export Excel/Word/PDF/ZIP (Sprint 10).

Tất cả mutation có Origin, confirmed=true, revision và requestId; ràng buộc retry cùng actor/action/declaration/input/comment/answers. Role/scope và phân công khóa SHARE, đợt rồi declaration khóa trước khi đọc revision, quyết định append trong cùng transaction với audit; lỗi audit rollback. Trigger bảo vệ append-only, trình tự/action, dữ liệu snapshot và tổng điểm, actor quyền hiện tại, tách hai người. Evidence giữ nguyên byte; kiểm hash/size trước xác nhận và khi tải, kiểm quyền trước/sau I/O, không giữ transaction trong lúc đọc đĩa. Cache private/no-store kể cả lỗi; strict input chặn coercion điểm và trường thừa; queue có keyset pagination, permission lọc trước limit.

UI cùng thiết kế hiện có: chọn đợt/lớp, thống kê và danh sách phân trang; chi tiết so sánh điểm sinh viên/cố vấn, minh chứng cạnh từng nhóm, lịch sử và xác nhận rõ ràng trước action. Lỗi 401/403/404 xóa dữ liệu; 409 khóa action đến khi tải lại; phản hồi cũ không ghi đè hồ sơ mới; giữ lời nhận xét khi lỗi mạng. Student xem riêng kết quả và điểm tự kê khai. Dùng ui-ux-pro-max cho xác nhận, nhãn và responsive.

Diễn tập Sprint 9 riêng bằng PostgreSQL tmpfs, storage clone và tài khoản giả, .14:3036/3037, parent IPC và guard từ chối nguồn/production. Test vòng trả về/xác nhận lại/duyệt, scope/role/phân công hiện tại, separation, idempotency/revision/race/audit, bytes, queue/aggregate, HTTP và browser thật trước đóng local. Giữ SHA bằng chứng Sprint 8 và 7, mẫu Word, roadmap người dùng; không khởi động/migrate nguồn legacy. Production, chứng thư/khóa thật, backup/restore schema mới và UAT nằm ngoài nghiệm thu kỹ thuật local.
