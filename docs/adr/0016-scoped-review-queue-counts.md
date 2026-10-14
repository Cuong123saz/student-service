---
status: Accepted
date: 2026-10-14
scope: Local technical continuation of Sprint 6
---

# ADR 0016: Tổng số hồ sơ theo quyền và bộ lọc hàng đợi

Theo yêu cầu tiếp tục dự án sau Sprint 5. Không thay đổi schema, nghiệm thu vận hành hoặc thẩm quyền ký. Giấy xác nhận sinh viên vẫn OFFLINE tại CTSV.

- GET review-submissions ở cả user/admin bổ sung counts cho năm trạng thái đã gửi. Không đếm DRAFT, hồ sơ của chính cán bộ, ngoài scope hoặc ngoài visibility hiện tại. Dùng cùng reviewVisibility và bộ lọc tìm kiếm/phân công với trang kết quả; không suy tổng từ limit20.
- Counts không phụ thuộc trạng thái đang mở hoặc cursor, để so sánh các nhóm trong cùng bộ lọc. Giữ semantics trang mặc định SUBMITTED/IN_REVIEW. Tổng là số liệu tại lần tải, không phải cam kết thời gian thực hoặc tổng toàn hệ thống.
- Quyền, nhóm đếm và trang đọc trong một transaction REPEATABLE READ, READ ONLY. Cả hai truy vấn dùng cùng predicate. Không mở endpoint toàn cục, không cache xuyên người dùng, không thêm quyền vào role.
- UI chỉ hiển thị số do máy chủ trả; khi chưa có counts dùng nhãn hiện tại. Xóa counts khi đổi bộ lọc, đổi phiên hoặc mất quyền. Response cũ không ghi đè sau khi đổi bộ lọc/phiên. Dùng nút Tải lại hiện có để cập nhật.
- Giữ API phân trang và consumer cũ tương thích. Client mới chấp nhận counts chưa có khi chạy với API cũ; không giả thành0. Nhãn nút và mô tả số lượng phải dùng được bằng bàn phím/trình đọc màn hình.
- Kiểm chứng vượt một trang, đủ trạng thái, tìm kiếm literal, phân công, chỉ định cán bộ, current role/status/scope, user/admin portal và late responses. Chỉ dùng database/kho giả riêng. Không triển khai production hoặc tự đóng Sprint 6 từ increment này.
