# Sprint 6 — Xét hồ sơ và tài liệu

Cập nhật 14/10/2026. Trạng thái **IN_PROGRESS**, theo yêu cầu tiếp tục dự án sau Sprint 5. Không coi increment này là đóng Sprint 6 hoặc nghiệm thu vận hành.

## Phạm vi kế hoạch

- Tiếp nhận đúng người/đơn vị/quyền hiện tại; bản nháp không vào hàng đợi.
- Xét hồ sơ, trả yêu cầu bổ sung, duyệt nội dung/từ chối; giữ lịch sử từng lần gửi và nguyên byte minh chứng.
- Word/PDF tự điền từ bản chốt, tải riêng theo quyền; gói tải đúng round, mẫu và minh chứng.
- Duyệt nội dung chưa phải ký/cấp văn bản. Giấy xác nhận sinh viên vẫn OFFLINE tại Phòng CTSV.

## Increment đã giao ngày 14/10

[Tổng số hồ sơ hàng đợi](review-queue-counts.md), theo ADR 0016: năm nhóm đếm bằng SQL trong cùng snapshot với trang; cùng visibility, tìm kiếm và phân công. UI ở user/admin, tương thích API cũ, xóa số cũ khi đổi phiên/bộ lọc/mất quyền; response đến trễ không ghi đè.

Kiểm chứng: 95 module API, 124 Web và 22 guard đạt; browser 25 hồ sơ thật trên môi trường giả, 6 nhóm/16 responsive/0 lỗi JavaScript. 8 ảnh viewport đã xem; môi trường diễn tập dừng và container riêng được dọn. Source development và trạng thái đóng Sprint 4/5 không thay đổi.

## Phần tiếp theo

1. Hoàn thiện ma trận kiểm chứng riêng Sprint 6 cho toàn luồng tiếp nhận → bổ sung → duyệt/từ chối → Word/PDF/gói tải, cả lịch sử và các portal. Các increment này đã có mã/bằng chứng lịch sử, cần đối chiếu phạm vi đóng riêng.
2. Tiếp phần B2 của ADR 0010: cấu hình runtime/kho tài liệu bền vững có kiểm tra sẵn sàng và đường quay lại. Vault/registry hiện có ở demo riêng; API chính vẫn render theo yêu cầu. Không tự bật trên database development cũ có lịch sử legacy chưa được nâng.
3. Trước dữ liệu thật: backup/restore trên thiết bị khác, retention, quét mã độc, đo tải phù hợp và nghiệm thu người dùng. Ký/phát hành thuộc Sprint 7, dùng thẩm quyền/chính sách được xác nhận riêng.
