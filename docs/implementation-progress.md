# Tiến độ triển khai và điểm tiếp tục

Cập nhật 11/10/2026. Đây là tiến độ mã nguồn/kiểm chứng local, không thay nghiệm thu của chủ dự án hoặc quy chế thực tế của Học viện. Sprint 2+3 giữ trạng thái CLOSED đã ghi nhận; Sprint 4 chưa tự đóng.

## Đã làm và kiểm chứng cục bộ

- Nền tảng tài khoản, hồ sơ sinh viên, khoa/lớp/cố vấn, RBAC theo phạm vi và quản trị/import/export.
- Cấu hình thủ tục có phiên bản: biểu mẫu đủ sáu kiểu trường, yêu cầu minh chứng, đơn vị/cán bộ/hàng đợi. Giấy xác nhận sinh viên OFFLINE tại CTSV.
- Nháp, minh chứng riêng tư, gửi và chốt từng round; nhận xử lý, yêu cầu bổ sung, duyệt nội dung/từ chối, bàn giao và thông báo trong ứng dụng. Quyền hiện tại được kiểm tra khi thao tác; lịch sử và tệp cũ giữ nguyên.
- Phiếu Word/PDF tự điền cho mọi loại hồ sơ điện tử, theo đúng round, chưa ký. Mẫu v1 khóa mã băm; từng round gắn id/hash/nguồn mẫu bất biến theo ADR0009. Round cũ gắn LEGACY_V1 rõ ràng, không fallback sang mẫu mới.
- Gói ZIP riêng từng round: Word, PDF, minh chứng nguyên byte, manifest kiểm tra toàn vẹn; công cụ kiểm tra ngoại tuyến và kiểm tra sẵn sàng Word/PDF. Đã kiểm chứng hai tác vụ đồng thời với gói nhỏ, từ chối tác vụ vượt mức và thử lại sau giải phóng; một hồ sơ đủ20MiB qua hợp đồng HTTP và PDF thật đạt; hai gói đủ20MiB đồng thời đạt trong profile Fastify inject/MemoryStorage, có kiểm tra cấu trúc PDF độc lập. Profile bổ sung dùng kho đĩa thật ổ D đạt; đọc minh chứng/mẫu/PDF có giới hạn trước cấp phát. Chưa đo gói lớn qua TCP hoặc tổng bộ nhớ máy.
- Nền tảng B2 có registry/job/lease và constraint/trigger append-only qua migration0023, repository quota chung và15 test SQL; mới áp vào test5434, chưa bật route/vault.
- Đối chiếu toàn vẹn kho, thử khôi phục/đóng gói/mã hóa và demo bằng dữ liệu giả, runtime tách khỏi bản dựng đang phát triển. B1 của ADR0010 đã thêm recovery v2 giữ mẫu và output riêng; đã phục hồi Word/PDF thật từ archive mã hóa vào cluster mới, metadata vẫn ghi rõ fixture/chưa có registry DB.

Chi tiết registry: [nền tảng B2](document-registry.md). Chi tiết phục hồi mới: [recovery v2](document-recovery-v2.md). Chi tiết và bằng chứng mới nhất: [phiếu Word/PDF](submission-documents.md), [gói tải](submission-bundles.md). Dữ liệu thực hành cũ ở 3011/3013 được giữ; bản gói mới ở `http://127.0.0.3:3015/login`, dùng DEMO 3 để tự thực hành.

## Việc kế tiếp theo thứ tự

1. Tiếp B2 của ADR0010: nối vault/worker và route tải lại byte đã lưu. Registry/job/lease migration0023 và repository đã đạt kiểm chứng SQL; chưa nối I/O. Thiết kế và rào chắn ADR đã commit; B1 recovery v2/namespace/mã hóa/fault tests đạt. Phần A gắn mẫu với round đã xong; route hiện chưa lưu byte đầu ra. B2 phải thay metadata fixture bằng registry thật, cập nhật audit, thử process chết/commit mất phản hồi và phục hồi registry trước khi bật lưu. Word công bố trước; PDF chuyển từ đúng Word đó để lỗi converter không chặn Word.
2. Sau nền tảng đó, triển khai mock signer phục vụ phát triển theo roadmap, kết quả ghi rõ mô phỏng; lưu kết quả xác minh kỹ thuật riêng với quyết định xét hồ sơ. Không dùng ảnh dấu/chữ ký để gán hợp lệ.
3. Muốn ký/phát hành thật cần mẫu chính thức, đơn vị ban hành, thẩm quyền/ủy quyền người ký, loại chữ ký bắt buộc và chính sách tin cậy của Học viện. Không suy ra thẩm quyền từ ADMIN hoặc quyền duyệt trong ứng dụng.
4. Trước dữ liệu thật: kiểm chứng backup trên thiết bị khác, retention, quét mã độc và tải với dung lượng/số người thực tế; hoàn tất nghiệm thu người dùng. Thời gian đo trên gói giả nhỏ không phải cam kết vận hành.

## Nguyên tắc giữ nguyên

Dùng dữ liệu giả khi thử. Không ghi đè template v1 hoặc file đã chốt. Lỗi tạo tài liệu không làm sinh viên gửi lại hồ sơ. Duyệt nội dung chưa phải phát hành; STUDENT_CONFIRMATION tiếp tục làm trực tiếp tại Phòng CTSV. Không tự kết luận chữ ký/hiệu lực pháp lý từ mã SHA-256.
