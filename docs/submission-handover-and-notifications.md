# Bàn giao hồ sơ và thông báo

Cập nhật 10/10/2026. Đã hoàn tất và kiểm chứng local theo [ADR 0006](adr/0006-submission-reassignment-and-notifications.md), đã Accepted và commit 68bd721 trước migration0018. Chủ dự án chấp nhận đợt gần nhất gồm bàn giao và thông báo trong ứng dụng; [phân trang hàng đợi](review-queue-pagination.md) đã bổ sung ở đợt tiếp theo; production vẫn ngoài phạm vi. Giấy xác nhận sinh viên vẫn trực tiếp tại CTSV.

## Bàn giao có kiểm soát

Người có submission.assign + submission.review và phạm vi đúng trên cùng role mở chi tiết hồ sơ Đang xử lý/Chờ bổ sung, chọn cán bộ đủ điều kiện, ghi lý do, xem lại và xác nhận bàn giao. Chỉ SYSTEM_ADMIN có grant assign mặc định; quản trị nghiệp vụ không tự có quyền. Người cũ có thể đã mất quyền; người mới phải đang hoạt động và đủ review/scope, không phải sinh viên của hồ sơ.

Bàn giao giữ nguyên trạng thái, nội dung và minh chứng của từng lần gửi, bản bổ sung đang sửa, tuyến xử lý và thời điểm nhận đầu tiên. Lịch sử ghi người giao, người cũ/người mới, lý do và thời điểm. Sinh viên gửi bổ sung về người mới. Hồ sơ chỉ định riêng được đọc theo người đang nhận; supervisor có ngoại lệ đọc để bàn giao trong hai trạng thái trên. Hồ sơ không chỉ định giữ quyền observer cùng phạm vi. Quyết định chỉ thuộc current reviewer đủ quyền.

Khi mất phản hồi hoặc gặp xung đột, giao diện giữ người/lý do đã nhập và yêu cầu tải lại trước khi tiếp tục. Retry chính xác không tạo bàn giao hoặc thông báo trùng. Không chuyển đơn vị hoặc mở lại hồ sơ đã duyệt/không chấp thuận.

## Hộp thông báo cá nhân

Mở Thông báo từ cổng sinh viên/cán bộ hoặc menu quản trị. Có Tất cả/Chưa đọc, Tải thêm, Đánh dấu đã đọc và Mở hồ sơ. Thông báo chỉ có nội dung chung và liên kết hồ sơ; yêu cầu/lý do chi tiết được xem trong hồ sơ sau kiểm tra quyền.

Sinh viên nhận thông báo khi yêu cầu bổ sung, có quyết định hoặc đổi cán bộ. Cán bộ nhận khi được chỉ định/nhận hồ sơ, được bàn giao hoặc sinh viên gửi bổ sung. Hàng đợi không chỉ định không phát thông báo hàng loạt cho mọi cán bộ. Không gửi lại thông báo cho sự kiện cũ, không dựng thông báo từ lịch sử trước tính năng này.

Thông báo được lưu cùng giao dịch hồ sơ. Inbox, số chưa đọc và thao tác đánh dấu đều kiểm tra đúng người nhận/quyền hiện tại; thông báo không còn quyền xem bị ẩn. Hai cổng dùng phiên riêng, dữ liệu giao diện tách người dùng/cổng. Cập nhật khi vào trang, trở lại cửa sổ hoặc tải lại; chưa có push/email hay cam kết thời gian thực.

## Kiểm chứng và phạm vi

Đã đạt 485 kiểm thử: 96 API unit, 255 API integration (bao gồm nâng cấp dữ liệu cũ và 12 tình huống mới), 102 Web và 32 kiểm thử cổng ADR. Typecheck, lint API, format, build API/Web và diff check đều đạt. Rà soát độc lập phát hiện lỗi phản hồi thông báo đi qua lúc đổi phiên; đã sửa và có hai regression test cho khoảng trống microtask.

Demo trình duyệt dùng tài khoản giả sinh viên/cán bộ cũ/cán bộ mới/supervisor trên DB test riêng, đã đạt:

- Bàn giao hồ sơ chỉ định riêng trong khi sinh viên đang sửa bổ sung, giữ nội dung/round/tệp/tuyến/thời điểm nhận đầu tiên.
- Mất phản hồi sau khi server đã lưu: khóa thao tác, giữ lý do, tải lại; retry không nhân đôi sự kiện/thông báo.
- Cán bộ cũ bị từ chối xem chi tiết/tải tệp; vô hiệu hóa cán bộ cũ rồi sinh viên vẫn gửi bổ sung về cán bộ mới.
- Hai chu kỳ bổ sung, duyệt và không chấp thuận; supervisor hết ngoại lệ đọc hồ sơ riêng sau quyết định cuối.
- Thông báo riêng đúng người/cổng, lỗi đánh dấu đọc giữ nguyên chưa đọc, đổi tài khoản trong cùng trình duyệt không thấy inbox cũ.
- Các trang hồ sơ và inbox ở 375/768/1024/1440 px không tràn ngang, không có lỗi JavaScript; đã xem ảnh kiểm tra desktop/mobile.

Migration0018 chỉ áp dụng DB development local sau khi kiểm tra đúng host/cổng/tên DB, migration trước và đúng một migration chờ. Đã đối chiếu giữ nguyên toàn bộ users, submissions, files, rounds, events, grants cũ và cấu hình STUDENT_CONFIRMATION; chỉ thêm grant assign cho SYSTEM_ADMIN, không dựng thông báo lịch sử. API3000/Web3001 đã khởi động lại; các endpoint riêng trả401 khi chưa đăng nhập, trang inbox mở được.

Bằng chứng chạy máy này nằm trong run/handover-api-{unit,integration,typecheck,lint,build}.log, run/handover-web-{tests,build}.log, run/handover-adr-tests.log, run/handover-format.log, run/handover-browser-smoke.log, run/handover-dev-migration.log, run/handover-local-health.log và ảnh run/handover-*.png. Đây là artifact local bị git ignore, không chứa tài khoản demo dùng lại; dữ liệu demo đã được dọn khỏi DB test.

Phân trang hàng đợi đã bổ sung theo ADR0007. Chưa ký/cấp văn bản, chưa phân trang lịch sử lần gửi, chưa production và không tự đóng Sprint4/5. Kho tệp, backup/retention/quét mã độc vẫn theo ADR0003. Không nên đưa vào vận hành chỉ vì luồng demo đã chạy đúng.
