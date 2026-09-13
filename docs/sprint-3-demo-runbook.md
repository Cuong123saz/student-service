# Runbook demo và nghiệm thu Sprint 3

## Mục tiêu

Runbook này giúp người demo chứng minh increment Sprint 3 hoạt động trên môi trường local, tập trung vào phân quyền, phạm vi dữ liệu, quản lý sinh viên, import, export, lời mời và audit log. Sprint chỉ được ký nghiệm thu sau khi người xem xác nhận các tiêu chí cuối tài liệu.

## Chuẩn bị trước demo

1. Khởi động PostgreSQL development, Mailpit, API và Web theo hướng dẫn trong `README.md`.
2. Đăng nhập bằng tài khoản quản trị local đã đổi mật khẩu và có các quyền cần thiết.
3. Chọn một lớp hành chính đang hoạt động mà tài khoản demo được phép quản lý.
4. Chạy `scripts/sprint-3-demo.ps1 -ClassCode <MA_LOP>` để tạo file CSV riêng cho lần demo và kiểm tra API/Web đang phản hồi.
5. Mở Mailpit tại `http://localhost:8025` để quan sát email kích hoạt.
6. Giữ `docs/sprint-3-test-report.md` sẵn để đối chiếu kết quả tự động.

Không đặt lại mật khẩu `system.admin` chỉ để demo. Không dùng dữ liệu sinh viên thật trong file mẫu hoặc ảnh chụp.

## Kịch bản demo

### 1 Đăng nhập và bảo vệ truy cập

1. Mở `http://localhost:3001/admin/login` và đăng nhập.
2. Xác nhận trang quản trị hiển thị đúng người dùng.
3. Trong cửa sổ riêng tư, mở `/admin/students/import` và xác nhận hệ thống chuyển về trang đăng nhập.

**Đạt khi:** session hợp lệ vào được trang quản trị; người chưa đăng nhập không truy cập được trang bảo vệ.

### 2 Phân quyền và phạm vi dữ liệu

1. Mở trang Phân quyền người dùng.
2. Chọn một tài khoản demo, xem role và scope hiện tại.
3. Xác nhận tài khoản chỉ nhìn thấy khoa, lớp hoặc đơn vị thuộc scope được giao.
4. Không thay quyền của `SYSTEM_ADMIN` trong buổi demo.

**Đạt khi:** dữ liệu hiển thị đúng scope và thao tác thiếu quyền bị từ chối rõ ràng.

### 3 Sửa thông tin sinh viên

1. Mở Danh sách sinh viên và chọn Sửa.
2. Thay đổi họ tên hoặc lớp hành chính, sau đó lưu.
3. Xác nhận khoa được đồng bộ theo lớp mới.
4. Thử nhập mã sinh viên có chữ và xác nhận giao diện/API từ chối.
5. Hoàn tác dữ liệu demo nếu cần.

**Đạt khi:** mã sinh viên chỉ nhận chữ số; tên, lớp và khoa sau lưu nhất quán.

### 4 Tải file Excel mẫu

1. Tại Danh sách sinh viên, chọn Tải Excel mẫu.
2. Mở file và xác nhận bốn cột: `studentCode`, `fullName`, `email`, `classCode`.
3. Xác nhận mã sinh viên mẫu được giữ ở dạng văn bản để không mất số 0 đầu.

**Đạt khi:** file mở được và đúng cấu trúc import.

### 5 Import sinh viên

1. Mở Import danh sách sinh viên.
2. Chọn file CSV do script demo vừa tạo.
3. Xem tổng số dòng, số hợp lệ, số lỗi và số nghi trùng.
4. Với file sạch, chọn chiến lược phù hợp rồi xác nhận import.
5. Xác nhận kết quả tạo mới, cập nhật và bỏ qua.
6. Tải lại cùng file để minh họa phát hiện trùng và không ghi dữ liệu ngoài ý muốn.

**Đạt khi:** preview không ghi database; confirm thành công; lỗi/trùng được diễn giải theo dòng; thao tác được ghi trong một transaction.

### 6 Export và lời mời kích hoạt

1. Quay lại Danh sách sinh viên, áp dụng một bộ lọc rồi xuất Excel.
2. Xác nhận file chỉ chứa dữ liệu phù hợp bộ lọc và scope.
3. Mở Mailpit và tìm email kích hoạt của sinh viên vừa import.

**Đạt khi:** export đúng phạm vi và job gửi lời mời được xử lý mà không lộ token trong log/audit.

### 7 Audit log

1. Mở Audit log.
2. Lọc theo Nhập sinh viên.
3. Mở chi tiết một sự kiện, kiểm tra actor, action, target, request ID và metadata.
4. Chuyển Trang sau rồi quay lại Trang trước.
5. Xác nhận metadata không hiển thị mật khẩu, token hoặc dữ liệu bí mật.

**Đạt khi:** bộ lọc, phân trang và chi tiết hoạt động; tài khoản thiếu `audit.read` nhận thông báo thiếu quyền.

## Bằng chứng cần lưu

- Commit được demo và ngày giờ demo.
- Kết quả lệnh test/build trong `docs/sprint-3-test-report.md`.
- Ảnh trang kết quả import, file export, email trong Mailpit và chi tiết Audit log; che thông tin nhạy cảm trước khi lưu.
- Danh sách lỗi phát hiện trong demo, người phụ trách và quyết định chặn hoặc không chặn nghiệm thu.

## Biên bản nghiệm thu

| Nội dung | Kết quả tái kiểm chứng | Ghi chú |
| --- | --- | --- |
| RBAC và scope | ☑ Đạt | Demo trực tiếp và integration test thuộc baseline đạt |
| Sửa thông tin sinh viên | ☑ Đạt kỹ thuật | Integration/acceptance test đạt; không lặp lại thao tác sửa trong phiên demo ngày 13/09 |
| Excel mẫu và Import | ☑ Đạt | File mẫu giữ số 0 đầu; import sạch và nhánh trùng/FAIL đã demo; P0.1–P0.5 đạt local |
| Export và invitation queue | ☑ Đạt | Export lọc lớp trả đúng 4 dòng trong scope; Mailpit nhận đủ 2 email demo |
| Audit log | ☑ Đạt | Import/email audit và phân trang đã xem trực tiếp; metadata không lộ token/mật khẩu |
| Regression và production build | ☑ Đạt | API 80 unit + 153 integration; Web 26 unit + 5 acceptance; hai production build đạt |

**Kết luận nghiệm thu:** ☑ Sprint 3 được nghiệm thu trên phạm vi và giới hạn ghi trong biên bản này.

**Người tái kiểm chứng kỹ thuật:** Codex — kiểm chứng tự động, không thay chữ ký nghiệp vụ.

**Ngày tái kiểm chứng:** 13/09/2026.

**Baseline demo:** `ba80759` chứa commit chức năng `ffa38f5`; nhánh trùng/FAIL và hồi quy cleanup được kiểm tra trên `777c3f9`.

**Giới hạn sau nghiệm thu:** Import API đạt local, chưa production-ready/deployed. Các hạng mục production readiness tiếp tục nằm trong backlog bên dưới.

**Người nghiệm thu chính thức:** Phan Phương Cường — Intern (người được ủy quyền).

**Ngày nghiệm thu chính thức:** 13/09/2026.

**Hình thức xác nhận:** xác nhận điện tử trong task Codex hiện tại.

**Artefact trạng thái máy đọc được:** [`docs/sprint-status.json`](sprint-status.json).

**Backlog chuyển tiếp:** production readiness cho import (capacity, retention/cleanup, backup/restore, worker operations, monitoring/alerting và rollback). ADR Sprint 4 chưa được khởi tạo trong quá trình đóng Sprint 3.
