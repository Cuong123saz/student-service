# Tiến độ triển khai và điểm tiếp tục

Cập nhật 11/10/2026. Đây là tiến độ mã nguồn/kiểm chứng local, không thay nghiệm thu của chủ dự án hoặc quy chế thực tế của Học viện. Sprint 2+3 giữ trạng thái CLOSED đã ghi nhận; Sprint 4 chưa tự đóng.

## Đã làm và kiểm chứng cục bộ

- Nền tảng tài khoản, hồ sơ sinh viên, khoa/lớp/cố vấn, RBAC theo phạm vi và quản trị/import/export.
- Cấu hình thủ tục có phiên bản: biểu mẫu đủ sáu kiểu trường, yêu cầu minh chứng, đơn vị/cán bộ/hàng đợi. Giấy xác nhận sinh viên OFFLINE tại CTSV.
- Nháp, minh chứng riêng tư, gửi và chốt từng round; nhận xử lý, yêu cầu bổ sung, duyệt nội dung/từ chối, bàn giao và thông báo trong ứng dụng. Quyền hiện tại được kiểm tra khi thao tác; lịch sử và tệp cũ giữ nguyên.
- Phiếu Word/PDF tự điền cho mọi loại hồ sơ điện tử, theo đúng round, chưa ký. Mẫu v1 khóa mã băm; từng round gắn id/hash/nguồn mẫu bất biến theo ADR0009. Round cũ gắn LEGACY_V1 rõ ràng, không fallback sang mẫu mới.
- Gói ZIP riêng từng round: Word, PDF, minh chứng nguyên byte, manifest kiểm tra toàn vẹn; công cụ kiểm tra ngoại tuyến và kiểm tra sẵn sàng Word/PDF. Đã kiểm chứng hai tác vụ đồng thời với gói nhỏ, từ chối tác vụ vượt mức và thử lại sau giải phóng; một hồ sơ đủ 20 MiB qua upload HTTP và PDF thật đạt, có kiểm tra cấu trúc PDF độc lập.
- Đối chiếu toàn vẹn kho, thử khôi phục/đóng gói/mã hóa và demo bằng dữ liệu giả, runtime tách khỏi bản dựng đang phát triển.

Chi tiết và bằng chứng mới nhất: [phiếu Word/PDF](submission-documents.md), [gói tải](submission-bundles.md). Dữ liệu thực hành cũ ở 3011/3013 được giữ; bản gói mới ở `http://127.0.0.3:3015/login`, dùng DEMO 3 để tự thực hành.

## Việc kế tiếp theo thứ tự

1. Tiếp phần B của ADR0009: thiết kế registry/job/lease và kho output để lưu byte/hash Word/PDF bất biến, phân biệt phiếu kê khai với kết quả phát hành. Phần A gắn mẫu với round đã xong; chưa lưu byte đầu ra. Cần bổ sung ADR chi tiết trước migration tiếp theo, cập nhật audit/backup/restore và thử process chết giữa ghi file/công bố trước khi bật lưu.
2. Sau nền tảng đó, triển khai mock signer phục vụ phát triển theo roadmap, kết quả ghi rõ mô phỏng; lưu kết quả xác minh kỹ thuật riêng với quyết định xét hồ sơ. Không dùng ảnh dấu/chữ ký để gán hợp lệ.
3. Muốn ký/phát hành thật cần mẫu chính thức, đơn vị ban hành, thẩm quyền/ủy quyền người ký, loại chữ ký bắt buộc và chính sách tin cậy của Học viện. Không suy ra thẩm quyền từ ADMIN hoặc quyền duyệt trong ứng dụng.
4. Trước dữ liệu thật: kiểm chứng backup trên thiết bị khác, retention, quét mã độc và tải với dung lượng/số người thực tế; hoàn tất nghiệm thu người dùng. Thời gian đo trên gói giả nhỏ không phải cam kết vận hành.

## Nguyên tắc giữ nguyên

Dùng dữ liệu giả khi thử. Không ghi đè template v1 hoặc file đã chốt. Lỗi tạo tài liệu không làm sinh viên gửi lại hồ sơ. Duyệt nội dung chưa phải phát hành; STUDENT_CONFIRMATION tiếp tục làm trực tiếp tại Phòng CTSV. Không tự kết luận chữ ký/hiệu lực pháp lý từ mã SHA-256.
