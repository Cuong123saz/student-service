---
status: Accepted
date: 2026-10-10
---

# ADR 0007: Phân trang và lọc hàng đợi tiếp nhận

Chủ dự án yêu cầu tiếp tục sau đề xuất phân trang, lọc và kiểm chứng với lượng hồ sơ lớn. Phạm vi đợt này là hàng đợi cán bộ ở hai cổng; giữ ADR0004–0006 về quyền, xử lý và thông báo. Không thay tài khoản/grant/cấu hình thủ tục, không ký/cấp, không production hoặc tự đóng sprint. ADR commit riêng trước migration0019 chỉ thêm chỉ mục.

## Hợp đồng

GET /api/v1/{user|admin}/review-submissions nhận status?: SUBMITTED|IN_REVIEW|NEEDS_SUPPLEMENT|APPROVED|REJECTED, assignment?: ALL|MINE|UNASSIGNED (mặc định ALL), q?:string tối đa100 ký tự sau trim, cursor?:string. Không nhận offset/limit tùy ý hoặc tham số khác. Trả {items:ReviewSummary[],nextCursor:string|null}, trang20, SQL lấy21 để xác định còn trang. Đây là thay đổi hợp đồng local có cập nhật đồng thời hai cổng, không giữ API mảng50 bị cắt âm thầm.

Quyền hiện tại và bảng visibility ADR0006 được lọc trước mọi bộ lọc/seek/limit. MINE là reviewerUserId hiện tại bằng actor (nhãn Tôi đang xử lý), UNASSIGNED là reviewerUserId NULL (chưa có người nhận); hồ sơ chỉ định nhưng chưa claim vẫn UNASSIGNED trong phạm vi được xem. q tìm substring không phân biệt hoa/thường, giữ dấu, trên tên/mã sinh viên snapshot khi gửi và serviceName đóng băng. %, _ và dấu gạch chéo ngược là ký tự literal, không cho wildcard. Không tìm trong câu trả lời, nội dung bổ sung đang sửa, lý do hoặc tệp.

Giữ ưu tiên hồ sơ gửi đầu tiên sớm nhất: submittedAt ASC,id ASC. submittedAt không đổi khi bổ sung/bàn giao; dùng mốc PostgreSQL UTC đủ6 chữ số microsecond và UUID để seek tuple > mốc cũ. Cursor base64url chứa [timestamp,id,fingerprint], validate độ dài/ký tự/JSON/timestamp thật/UUID/fingerprint. Fingerprint SHA256 gắn actor và bộ lọc đã chuẩn hóa; đổi người/bộ lọc thì cursor400 INVALID_CURSOR, UI tải lại trang đầu. Cursor không cấp quyền, mỗi trang kiểm tra quyền DB hiện tại. Không snapshot cố định: thay trạng thái/quyền có thể làm biến động hàng đợi, tải lại bắt đầu lại; không tính tổng đếm tốn kém hoặc hứa ảnh chụp nhất quán giữa các trang.

Truy vấn trang chỉ lấy trường summary bằng join đơn vị/cán bộ, không lấy procedure/values/files/history và không truy vấn đơn vị/cán bộ từng dòng. Thêm btree (status,submitted_at,id) và (processing_unit_id,status,submitted_at,id) trong migration0019, schema/snapshot đồng bộ; không extension hoặc sửa dữ liệu. Tìm substring vẫn có thể scan: kiểm chứng local có số liệu, không khẳng định chịu tải production.

## Giao diện và kiểm chứng

Hai cổng dùng chung queue: trạng thái, tìm kiếm có nhãn, phân công, Áp dụng bộ lọc/Xóa bộ lọc, số đang hiển thị (không gọi là tổng), Tải thêm20 hồ sơ. Đổi filter/tải lại bỏ cursor/danh sách cũ; không tải mỗi phím gõ. Loading/aria-busy/empty/error rõ ràng, lỗi tải thêm giữ trang trước và retry đúng cursor, 401/403 xóa dữ liệu cũ. Sequence + identity guard loại phản hồi trễ khi đổi filter/tài khoản/unmount, xóa dữ liệu khi phiên đổi, không trộn dữ liệu hai tài khoản/cổng. Markup keyboard/touch/mobile theo giao diện hiện có.

Kiểm chứng: >50 hồ sơ, nhiều mốc cùng timestamp và microsecond, không lặp/bỏ sót khi dữ liệu tĩnh; scope/designated/self/workingcopy không lọt; mọi filter trước limit; wildcard literal/injection/invalidquery/cursor khác người/filter; quyền bị thu hồi giữa trang; HTTP hai cổng/cookie; UI delayed load/filter/readerrors/accountswitch; browser thật desktop/mobile. Nạp dataset giả riêng DB test, đo trang đầu/trang sâu và EXPLAIN với dataset lớn, dọn dữ liệu test. Upgrade local kiểm tra đúng DB/migration trước, đối chiếu dữ liệu/grants/config cũ giữ nguyên. Kết quả ghi tài liệu sau thực thi, không dùng số liệu giả hoặc tự đặt SLA production.
