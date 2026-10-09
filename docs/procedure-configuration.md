# Cấu hình biểu mẫu và nơi xử lý

## Cách dùng

Mở trang quản trị /admin/procedures, mục **Biểu mẫu và nơi xử lý**.

1. Chọn dịch vụ **Cấp giấy xác nhận sinh viên** và đơn vị sở hữu **Phòng Công tác Sinh viên (CTSV)**.
2. Bấm **Tạo cấu hình**. Bản nháp mặc định chọn thực hiện trực tiếp tại đơn vị, hai thông tin hồ sơ cơ bản, không bắt buộc minh chứng.
3. Chọn đơn vị xử lý CTSV. Để **Theo phân công nội bộ** nếu phòng tự phân công cán bộ; chỉ chọn người cụ thể khi tài khoản và quyền đã được cấp đúng.
4. Ghi hướng dẫn thực tế cho sinh viên. Không tự đặt giờ làm việc, địa chỉ, phí hoặc giấy tờ cần mang khi chưa có thông tin xác nhận.
5. Chỉnh trường biểu mẫu/minh chứng nếu cần; xem trước, **Lưu bản nháp**, rồi **Áp dụng cấu hình**.
6. Trang chi tiết dịch vụ của sinh viên sẽ hiển thị hướng dẫn đến trực tiếp CTSV. Hướng dẫn được xem mà không cần đăng nhập.

Muốn thay đổi bản đã áp dụng: bấm **Tạo phiên bản mới**, sửa và áp dụng. Phiên bản cũ vẫn được giữ nguyên.

## Ai được cấu hình và xử lý

- Người cấu hình cần phiên quản trị ADMIN/SYSTEM_ADMIN, tài khoản ACTIVE, đã đổi mật khẩu và quyền service.configure.
- GLOBAL được khởi tạo/giao đơn vị sở hữu. ORGANIZATION được sửa, áp dụng và clone cấu hình thuộc đơn vị sở hữu của mình.
- Người xử lý được chọn phải ACTIVE, có quyền submission.review và scope ORGANIZATION đúng đơn vị hoặc GLOBAL, trên cùng role assignment.
- OFFLINE không yêu cầu người xét duyệt online. Có thể giao cho đơn vị tiếp nhận và để phòng phân công nội bộ.
- ONLINE/HYBRID kiểm tra cán bộ phù hợp trước khi áp dụng. Chức năng nộp hồ sơ và xét duyệt online chưa được mở ở increment này.

Cấu hình biểu mẫu mô tả dữ liệu cần khai; nó không tự thay quy trình tiếp nhận ngoài đời. Yêu cầu hiện tại của giấy xác nhận sinh viên là làm việc trực tiếp với CTSV.

## Kiểm chứng ngày 09/10/2026

Node 22.23.2; PostgreSQL 17; bản web production build thử local.

- ADR gate 19/19; API unit 90/90; 16/16 integration cấu hình.
- Hồi quy integration cuối: 169/169, bao gồm ca CORS preflight PUT từ web.
- Web 35/35, trong đó acceptance Nuxt 14/14 và bảy ca mới cho cấu hình. Acceptance được chạy lại riêng, không cộng trùng.
- API typecheck, lint, format, API build và Web build đạt.
- Demo phát hiện CORS mặc định không cho PUT từ web. Đã khai báo GET/HEAD/POST/PUT/PATCH/DELETE, giữ nguyên origin và credentials, có kiểm thử preflight cùng demo lưu thật.
- Migration 0014 tạo bảng/constraint/trigger mới; đã chạy ở test sạch và development, không reset development.
- Demo Chromium đi qua Web → API → PostgreSQL đạt: đăng nhập thật, tạo nháp OFFLINE CTSV, thêm trường, lưu, áp dụng, clone v2, áp dụng v2, v1 giữ nguyên; trang sinh viên chỉ dẫn thực hiện trực tiếp. Kiểm tra desktop/mobile 375 px, menu mở/đóng, không tràn ngang và không có lỗi JavaScript. Dữ liệu demo dùng database student_service_test cổng 5434, tài khoản tạm và hai máy chủ riêng 3010/3011; đã dọn sau kiểm thử.

Log và ảnh local nằm trong thư mục run, không đưa dữ liệu thử/ảnh vào lịch sử Git. Quyền, scope, inactive user/unit, conflict và rollback audit có integration test; UI mock không thay thế demo toàn luồng.

Trang local đã được bật tại http://localhost:3001/admin/procedures, API tại http://localhost:3000. Database development có migration mới và chưa có bản cấu hình được áp dụng. Dùng tài khoản quản trị hiện có để tạo và áp dụng cấu hình thực tế; không tự tạo/đổi mật khẩu người dùng.

## Phạm vi increment

Đã có cấu hình, xem trước và hướng dẫn công khai cho OFFLINE. Chưa có nộp hồ sơ, upload thật, hàng đợi xét duyệt, sinh DOCX/PDF hoặc ký. Đó là phạm vi increment cấu hình Sprint 4. Increment kế tiếp đã có [kê khai bản nháp và tải minh chứng ở Sprint 5](sprint-5-drafts.md); gửi hồ sơ/xét/ký vẫn chưa mở.
