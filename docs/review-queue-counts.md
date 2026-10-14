# Tổng số hồ sơ trong hàng đợi xét

Ngày 14/10/2026. Increment local của Sprint 6, theo [ADR 0016](adr/0016-scoped-review-queue-counts.md). Chưa đóng Sprint 6 hoặc triển khai production.

## Cách dùng

Trong Tiếp nhận hồ sơ ở cổng cán bộ hoặc quản trị, năm nút trạng thái hiển thị số hồ sơ thuộc quyền và phạm vi hiện tại. Ví dụ nhóm Chờ tiếp nhận có 21 hồ sơ: trang đầu hiển thị 20, số trên nút vẫn là 21; tải thêm không làm số tổng thành 1 hoặc 20.

Nhập tên/mã sinh viên/thủ tục và chọn phân công rồi Áp dụng bộ lọc. Số của cả năm nhóm được tính theo tìm kiếm và phân công đã áp dụng. Chọn trạng thái khác để xem nhóm đó. Tải lại cập nhật theo dữ liệu mới nhất; chưa tự cập nhật thời gian thực. Số đang hiển thị trong danh sách và tổng nhóm là hai thông tin khác nhau, không phải tổng toàn hệ thống.

Bản nháp, hồ sơ ngoài đơn vị, hồ sơ của chính cán bộ và hồ sơ chỉ định người khác không được đếm khi người xem không có visibility tương ứng. ADMIN không tự có quyền xét. Đơn vị/tài khoản ngừng hoặc quyền bị thu hồi được kiểm tra lại. Giấy xác nhận sinh viên vẫn OFFLINE tại Phòng CTSV.

## Hợp đồng và nhất quán

GET `/api/v1/{user|admin}/review-submissions` bổ sung `counts` gồm SUBMITTED, IN_REVIEW, NEEDS_SUPPLEMENT, APPROVED và REJECTED, mỗi giá trị là số nguyên không âm. Giữ items/nextCursor và giới hạn 20. Counts dùng cùng reviewVisibility, q và assignment như trang; không dùng status hoặc cursor để cắt số tổng.

Quyền, truy vấn GROUP BY và trang dùng một transaction REPEATABLE READ/READ ONLY. Không thêm cache giữa các người dùng, endpoint tổng toàn cục hoặc quyền mới. Các trang khác nhau có thể phản ánh thời điểm khác nhau; khi hồ sơ thay đổi hãy Tải lại.

Client cũ bỏ qua trường mới. Client mới với API cũ không có counts giữ nhãn hiện tại, không suy thành 0 hoặc items.length. Đổi bộ lọc/phiên/mất quyền xóa số cũ; response đến trễ không ghi đè bộ lọc/phiên mới. Nút giữ tên truy cập; số có mô tả hồ sơ và một thông báo ngữ cảnh cho nhóm đang chọn.

## Kiểm chứng

Mã triển khai đã kiểm chứng: `2d4e1b0f0d9b5a7fe90dc24d2da5d2f5c0a4915f`. ADR đã commit trước ở `fc073bb`. Report trình duyệt SHA-256: `baddd609cc4e055733624e087b39e32b7c4cb8ffc6e90c4b786864035d47b9c5`; ảnh và `visual-review.json` nằm trong cùng thư mục lượt.

Bằng chứng local trong project/run, bỏ qua Git. Diễn tập `ddea1945-50c3-4bc8-98c3-32ed134a5eca` dùng 25 hồ sơ được tạo/lưu/gửi qua HTTP thật trong PostgreSQL/kho giả riêng. Tạo đủ năm trạng thái bằng claim/resolve thật; không sửa response API.

PASS 6 nhóm: tổng vượt 20 và không đổi theo cursor; tìm kiếm/phân công; Tải lại sau nhận hồ sơ; ngoài scope/sinh viên/sai portal bị chặn; CTSV giữ OFFLINE ; 0 lỗi JavaScript. 16 lượt responsive 375/768/1024/1440 trên bốn màn hình ; 8 ảnh viewport đã xem. Kết thúc STOPPED và xóa container riêng. Đây không phải URL đang hoạt động cho người dùng.

Kiểm thử API bổ sung/tăng cường: hơn 50 hồ sơ, đủ trạng thái, tự xử lý, chỉ định người khác, đơn vị ngừng, tài khoản ngừng, tìm kiếm literal và byte dữ liệu riêng không tham gia tìm kiếm. Hợp đồng HTTP user/admin giữ số tổng qua trang tiếp. Web kiểm tra counts từ máy chủ, API cũ không có counts, response cũ đến trễ và mất quyền. Lượt cuối đạt 95/95 kiểm thử module hồ sơ, 124/124 Web (đã gồm acceptance) và 22/22 guard diễn tập. Typecheck, lint, format, build API/Web và ADR gate đạt. Không cộng các lượt chạy lại hoặc gọi 95 là toàn bộ integration của dự án.

Log đạt: `run/sprint6-counts-api-tests-verified-20261014.log`, `run/sprint6-counts-web-tests-20261014.log`, `run/sprint6-counts-guards-final-20261014.log`, `run/sprint6-counts-build-20261014.log` và các log quality có hậu tốverified/final. Lượt API đầu 91 đạt/4 lỗi do kỳ vọng DTO cũ; các assertion đã được cập nhật để vẫn kiểm tra trang rỗng cùng counts đúng. Một lượt CLI migrate trả 1 không có lỗi SQL rõ ràng; log được giữ riêng. Lượt verified chờ pg_isready, dùng chính Drizzle migrator/journal canonical và chỉ database test 5434; không nới guard hoặc sửa lịch sử migration.

## Phạm vi kế tiếp

Hoàn thiện ma trận kiểm chứng và hồ sơ Sprint 6 cho tiếp nhận, bổ sung/duyệt, Word/PDF và gói tải. API chính vẫn dùng sinh tài liệu theo yêu cầu; stored vault đã có ở runtime diễn tập riêng. Không bật vault/migrate nguồn development hoặc coi kiểm tra local là nghiệm thu dữ liệu thật từ increment số đếm này.
