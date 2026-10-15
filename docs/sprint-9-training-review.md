# Sprint 9 — Xét duyệt điểm rèn luyện

Theo [kế hoạch Sprint 9](sprint-9-plan.md) và [ADR 0020](adr/0020-training-points-review-workflow.md): cố vấn xác nhận từng bản, khoa duyệt/trả về, tổng hợp cấp lớp. Điểm tự kê khai Sprint 8 được giữ nguyên; các vòng xét duyệt lưu riêng. Bộ A–E hiện là giả định để thử nghiệm, chưa tạo xếp loại chính thức.

## Cấp quyền và sử dụng

Quản trị cấu hình vai trò/phạm vi và phân công qua các mục hiện có. Cố vấn cần ACADEMIC_ADVISOR, quyền training_point.review trên chính vai trò đó, phạm vi lớp/khoa/toàn hệ thống phù hợp và phân công lớp đang có hiệu lực. Cán bộ khoa cần FACULTY_REVIEWER, quyền training_point.faculty_approve và phạm vi khoa/toàn hệ thống phù hợp. Quyền nằm trên vai trò khác không được ghép để thay thế. SYSTEM_ADMIN không tự thay cố vấn hoặc khoa.

Người xử lý đăng nhập cổng người dùng, mở **Xét duyệt điểm rèn luyện**, chọn đợt/lớp. Hệ thống chỉ hiển thị bản đã nộp trong quyền hiện tại. Có bộ lọc trạng thái, thống kê trên toàn bộ bản đã nộp và tải thêm 25 bản mỗi lần. Điểm trung bình chỉ tính các bản khoa đã duyệt.

Cố vấn mở bản, đối chiếu điểm/giải trình gốc và tải minh chứng ở từng nhóm. Nhập điểm xét duyệt A–E; điểm nguyên trong giới hạn, giải trình khi điểm dương hoặc thay đổi điểm. Nhóm có điểm xét duyệt dương phải có minh chứng trong bản nộp gốc nếu tiêu chí yêu cầu; không tăng điểm để bỏ qua minh chứng bắt buộc. Nhập nhận xét xử lý, chọn **Kiểm tra xác nhận cố vấn**, xem lại rồi đánh dấu và xác nhận. Bản chuyển sang **Chờ khoa**. Bản đã đóng thời gian kê khai vẫn được xét duyệt.

Khoa đối chiếu điểm cố vấn và minh chứng. Nhập nhận xét rồi chọn duyệt hoặc trả về; bước kiểm tra/đánh dấu bắt buộc. Trả về chỉ mở lượt xác nhận mới cho cố vấn, không mở sửa bản sinh viên. Khoa đã duyệt kết thúc quy trình của bản trong Sprint 9. Một tài khoản không được xác nhận cố vấn và duyệt khoa trong cùng vòng, kể cả có cả hai vai trò; không xử lý bản của chính mình.

Sinh viên mở bản đã nộp trong **Điểm rèn luyện** để xem riêng trạng thái, điểm xét duyệt từng vòng, nhận xét và người xác nhận. Sinh viên chuyển lớp vẫn xem được kết quả của mình; quyền xử lý theo lớp của đợt gốc. Lịch sử giữ tên người xác nhận tại thời điểm thực hiện.

Khi quyền/phân công đã thay đổi, giao diện xóa dữ liệu không còn được xem. Khi xung đột cập nhật hoặc lỗi mạng, giữ nhận xét tại chỗ và yêu cầu tải lại trước khi xử lý tiếp. Không gửi thêm quyết định nếu chưa biết kết quả yêu cầu trước.

## Xác nhận và bảo toàn

Xác nhận nghiệp vụ ghi tài khoản, vai trò, thời gian máy chủ, điểm, nhận xét và SHA-256 đối chiếu với bản nộp gốc. Chữ ký số luôn NOT_VERIFIED và legalEffect=false: chưa có chứng thư, khóa hoặc nhà cung cấp ký thật. Ảnh dấu/chữ ký trong minh chứng vẫn NOT_CHECKED. Không tự đóng dấu đỏ hoặc coi đăng nhập là chữ ký số đã xác minh.

Migration 0027 thêm bảng training_review_decisions append-only. Trigger kiểm trình tự, quyền hiện tại, tách người, snapshot và mã băm; quyết định và audit cùng transaction. RequestId có ràng buộc actor/action/bản/revision/nội dung để chống gửi lặp. Kiểm quyền trước/sau đọc minh chứng, kiểm SHA-256/size trước xác nhận và lúc tải. Không sửa bảng/bản SUBMITTED của Sprint 8.

API cổng user: GET /training-reviews/periods; GET /training-reviews/periods/:id (cursor/state); GET /training-reviews/:id; GET /training-reviews/:id/files/:fileId; POST /training-reviews/:id/advisor-sign, /faculty-return, /faculty-approve. Sinh viên GET /training-declarations/:id/review. Mutation yêu cầu Origin, confirmed=true, expectedRevision từ kết quả xét duyệt và requestId UUID. Cache private/no-store kể cả lỗi; không trả storage key. Chi tiết hiển thị 100 quyết định gần nhất và cờ lịch sử bị rút gọn.

## Kiểm chứng riêng

Sau khi build API/Web, chạy npm run rehearse:sprint9 --workspace @student-service/api. Launcher cần --fake-data-only, PostgreSQL tmpfs/storage riêng và checker con có IPC. Web .14:3037, API .14:3036, trạng thái riêng dưới run/workflow-demo/UUID. Launcher tự dừng tiến trình và xóa container sở hữu, không nâng nguồn legacy. Kết quả browser và kiểm thử được lưu riêng trước khi đóng kỹ thuật local.

Giấy xác nhận sinh viên vẫn OFFLINE tại CTSV. Xuất Excel, biên bản Word/PDF/ZIP thuộc Sprint 10. Chứng thư/khóa ký thật, phê duyệt quy chế, backup/restore với bảng review mới, tải production và UAT cần nghiệm thu ở mốc vận hành sau.
