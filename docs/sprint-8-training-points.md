# Sprint 8 — Đợt đánh giá và kê khai điểm rèn luyện

Phạm vi theo kế hoạch hợp nhất: quản lý đợt, tiêu chí A–E, bản nháp, minh chứng và lịch sử. Điểm tự kê khai luôn ghi **chưa xét duyệt**; xét duyệt cố vấn/khoa thuộc Sprint 9, xuất bảng/biên bản thuộc Sprint 10.

## Cách sử dụng

Quản trị mở **Đợt điểm rèn luyện** trong menu quản trị, chọn lớp, năm học/học kỳ, thời gian và năm nhóm tiêu chí có tổng 100 điểm. Bộ mặc định 20 điểm/nhóm là giả định để thử nghiệm. Lưu bản nháp rồi kiểm tra và xác nhận mở đợt. Tiêu chí và thời hạn khóa sau khi mở; đóng đợt không mở lại. Tài khoản phải có quyền `training_point.period.manage` và phạm vi cùng vai trò GLOBAL/FACULTY/CLASS; mặc định chỉ SYSTEM_ADMIN.

Sinh viên chọn **Điểm rèn luyện** trong cổng cá nhân. Mỗi sinh viên có một bản kê khai cho mỗi đợt. Có thể lưu thiếu điểm; giá trị 0 được giữ nguyên, ô trống là chưa khai. Khi nộp, cần đủ năm nhóm, điểm nguyên không vượt giới hạn và giải trình khi điểm lớn hơn 0. Nhóm có yêu cầu minh chứng cần ít nhất một tệp nếu kê khai điểm dương.

Lưu nội dung trước khi thêm/gỡ tệp để tránh mất thông tin đang nhập. Chấp nhận PDF/PNG/JPEG, tối đa 5 MiB/tệp, 3 tệp/nhóm, 10 tệp và 20 MiB/bản kê khai. Kiểm tra lại từng nhóm và đánh dấu xác nhận để nộp. Bản đã nộp chốt thông tin sinh viên, tiêu chí, trả lời, danh sách tệp và tổng điểm; không sửa hoặc gỡ tệp. Lịch sử vẫn xem được khi đợt đóng hoặc sinh viên chuyển lớp.

## API và dữ liệu

Admin `/api/v1/admin/training-periods`: catalog, danh sách, chi tiết, tạo, sửa, `/open`, `/close`. User `/api/v1/user/training-periods`: danh sách và `/:id/declaration`; `/training-declarations/:id`: xem, lưu, `/submit`, `/evidence/:criterion`, `/files/:fileId` tải/gỡ. Thao tác sửa có Origin, revision; upload/nộp có requestId chống gửi lặp. Dữ liệu hồ sơ và tổng điểm do máy chủ tính/chốt, không nhận profile hoặc trạng thái duyệt từ người dùng.

Migration 0026 và [ADR 0019](adr/0019-training-points-foundation.md) quy định vòng đời, snapshot và lịch sử bất biến. Kiểm quyền hiện tại trước/sau I/O, giới hạn và SHA-256 khi đọc, kiểm lại tệp trước nộp. Mỗi thay đổi và audit cùng giao dịch; ghi audit lỗi thì hoàn tác. Kho minh chứng nằm trong thư mục UUID riêng `training-points` bên dưới `SUBMISSION_STORAGE_ROOT`; API không trả storage key. Tệp có trạng thái NOT_CHECKED, không tự coi ảnh dấu/chữ ký là chữ ký số hợp lệ.

## Diễn tập riêng

Sau khi dựng API và web, chạy `npm run rehearse:sprint8 --workspace @student-service/api` với cấu hình Playwright/Chromium của máy nếu chưa cài mặc định. Launcher chỉ nhận `--fake-data-only`, dùng PostgreSQL tmpfs và thư mục `run/workflow-demo/<UUID>` riêng. Web tại `http://127.0.0.13:3035`, API `http://127.0.0.13:3034`; trình kiểm thử phải là tiến trình con có IPC. Kết thúc tự dừng tiến trình và xóa đúng container sở hữu. Không khởi động hoặc nâng cấp cơ sở dữ liệu nguồn legacy.

Sprint 8 **CLOSED kỹ thuật local ngày 15/10/2026**: [hồ sơ đóng](sprint-8-closure.md) ghi 744 kiểm thử đạt/1 bỏ qua, 14 nhóm trình duyệt, 20 responsive và 10 ảnh đã rà. [Trạng thái máy đọc](sprint-8-status.json) lưu phạm vi và mã thực thi đã kiểm chứng. Giấy xác nhận sinh viên vẫn OFFLINE tại Phòng CTSV. Quy chế thật, phân công xét duyệt, chấp thuận cơ quan, triển khai/backup/UAT production chưa nằm trong nghiệm thu kỹ thuật Sprint 8.
