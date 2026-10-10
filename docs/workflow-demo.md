# Thử quy trình hồ sơ bằng dữ liệu giả

Bộ demo tạo PostgreSQL riêng, kho minh chứng riêng và hai máy chủ riêng. Giấy xác nhận sinh viên vẫn **OFFLINE tại Phòng CTSV**; các thủ tục ONLINE dưới đây chỉ phục vụ thử nghiệm. Trạng thái “Đã duyệt nội dung” chưa cấp văn bản; mọi minh chứng vẫn có chữ ký `NOT_CHECKED`.

## Mở và đăng nhập

Mở <http://127.0.0.1:3011/login>. Dùng đúng `127.0.0.1` để tách cookie với môi trường phát triển tại `localhost:3001`.

| Tài khoản giả   | Công dụng                                                     |
| --------------- | ------------------------------------------------------------- |
| `demo.sinhvien` | Kê khai, gửi, bổ sung và xem lịch sử của mình                 |
| `demo.canbo`    | Nhận và xử lý hồ sơ đúng đơn vị; dùng được hai cổng đăng nhập |
| `demo.svkhac`   | Kiểm tra sinh viên khác không đọc được hồ sơ/minh chứng       |
| `demo.ngoai`    | Kiểm tra cán bộ ngoài phạm vi không đọc được hồ sơ/minh chứng |

Mật khẩu chung, chỉ dành cho demo: `DemoSinhVien#2026!`. Tài khoản cán bộ quản trị có quyền xét hồ sơ trong đơn vị, không phải quản trị toàn hệ thống.

Trong **Dịch vụ**, chọn **DEMO 3 - Bạn tự thực hành**. DEMO 1 và DEMO 2 được bài kiểm thử sử dụng để tạo hồ sơ mẫu đã duyệt và bị từ chối; DEMO 3 được kiểm tra là chưa có hồ sơ của sinh viên mẫu.

## Tự thử từng bước

1. Đăng nhập `demo.sinhvien`, mở DEMO 3 và chọn **Kê khai / tiếp tục bản nháp**. Bốn trường hồ sơ cá nhân được điền từ máy chủ và không sửa trực tiếp trong đơn.
2. Điền mã tham chiếu `TEST-TU-THU-001`, mục đích giả định, số tín chỉ `0`, ngày mong muốn, nhóm mục đích và lựa chọn **Không**. Lưu bản nháp.
3. Tải lên `apps/api/scripts/fixtures/recovery/evidence-round-1.pdf`. Demo giới hạn một tệp PDF tối đa 4096 byte; tệp mẫu đáp ứng giới hạn. Chọn **Xem lại thông tin**, xác nhận và **Gửi hồ sơ**.
4. Dùng một trình duyệt khác hoặc cửa sổ riêng tư để đăng nhập `demo.canbo`. Mở **Tiếp nhận hồ sơ**, chọn hồ sơ rồi **Nhận xử lý**.
5. Chọn **Yêu cầu bổ sung**, ghi lý do, **Xem lại quyết định**, xác nhận và **Ghi quyết định**.
6. Sinh viên mở thông báo, sửa thông tin, gỡ minh chứng cũ và tải `evidence-round-2.pdf`, lưu rồi xem lại/xác nhận/**Gửi bổ sung**. Hồ sơ quay về cán bộ đang nhận; không phải nhận lại lần nữa.
7. Cán bộ chọn duyệt nội dung hoặc không chấp thuận, ghi lý do rồi xem lại/xác nhận. Sinh viên kiểm tra trạng thái, lịch sử hai lần gửi và tải lại minh chứng gốc của từng lần.

## Khởi động lại môi trường

Cần Node 22.19 trở lên trong nhánh 22, Docker đang chạy, ảnh `postgres:17-alpine` đã có sẵn và các phụ thuộc dự án đã được cài. Công cụ không tự tải ảnh. Cổng 3010 và 3011 phải trống. Chạy ở thư mục gốc dự án, trong terminal không nạp `DATABASE_URL` hoặc `SUBMISSION_STORAGE_ROOT` của môi trường khác:

```powershell
npm run build
npm run demo:workflow --workspace @student-service/api
```

Giữ terminal chạy. Khi thấy `WORKFLOW_DEMO_READY`, mở địa chỉ phía trên. Công cụ tạo dữ liệu mới mỗi lượt, không đọc `.env` của ứng dụng, không chạy worker/email. Cơ sở dữ liệu chỉ ở bộ nhớ tạm; dừng demo sẽ mất hồ sơ thử của lượt đó. Kho tệp và báo cáo cục bộ nằm trong `run/workflow-demo/<runId>/` trên ổ đặt dự án (hiện là D), được Git bỏ qua. Không dùng bộ demo này để lưu hồ sơ thật hoặc thay cho sao lưu.

Dừng từ terminal khác, cũng ở thư mục gốc:

```powershell
npm run demo:workflow --workspace @student-service/api -- stop
```

Lệnh chỉ gửi yêu cầu đến lượt demo đã được đánh dấu. Tiến trình đang chạy kiểm tra ID, tên, nhãn, ảnh và kiểu lưu trữ của container trước khi dọn; không dừng/xóa hai container phát triển và kiểm thử hiện có. Chờ `state.json` ghi `STOPPED` trước khi khởi động lại. Nếu máy/Docker bị tắt đột ngột, lệnh dừng cần tiến trình demo còn chạy để tiếp nhận; kiểm tra môi trường trước khi mở lượt mới.

## Kiểm thử tự động và bằng chứng

Bài kiểm thử thao tác qua trình duyệt Chromium riêng, không điều khiển tab người dùng. Cần Playwright và Chromium đã được cài; mặc định tìm package `playwright`. Có thể dùng package có sẵn bằng đường dẫn `WORKFLOW_PLAYWRIGHT_MODULE` và tệp thực thi Chromium qua `WORKFLOW_CHROMIUM_EXECUTABLE`.

```powershell
npm run demo:workflow:check --workspace @student-service/api
```

Chỉ chạy một lần trên lượt demo mới, trước khi tự tạo hồ sơ bằng tài khoản mẫu. Bài kiểm thử dùng giao diện để đăng nhập, tạo/lưu/tải tệp/gửi hồ sơ, yêu cầu bổ sung, mở thông báo, gửi lại, duyệt và từ chối. Các yêu cầu HTTP bổ sung kiểm tra từ chối truy cập và chống ghi lặp, không thay cho thao tác giao diện.

Kết quả ngày 10/10/2026: các lượt môi trường mới chạy đạt. Lượt cuối kiểm chứng:

- Đủ sáu kiểu trường TEXT/TEXTAREA/NUMBER/DATE/SELECT/BOOLEAN, giữ đúng số `0`, boolean `false`, Unicode, dữ liệu hồ sơ lấy từ máy chủ và chặn gửi thiếu thông tin.
- Nhánh bổ sung–duyệt giữ hai snapshot, một lần nhận xử lý, đúng cán bộ và đúng thứ tự sự kiện; yêu cầu duyệt lặp không tạo quyết định thứ hai. Nhánh từ chối khóa chỉnh sửa/gửi tiếp.
- Sinh viên khác và cán bộ ngoài đơn vị không đọc được hồ sơ/tệp; phiên cổng quản trị và người dùng tách biệt.
- Mở thông báo đánh dấu đã đọc, bộ đếm giảm đúng; tải PDF hiện tại và PDF lịch sử khớp toàn bộ byte với tệp gốc. Gỡ tệp hiện tại không làm mất bản lịch sử.
- Năm màn hình ở bốn độ rộng 375/768/1024/1440 không tràn ngang; có ảnh ở 375 và 1440, không có lỗi JavaScript trang.
- Giấy xác nhận sinh viên hiển thị hướng dẫn đến CTSV và không có nút kê khai; tệp vẫn chưa xác minh chữ ký. DEMO 3 chưa có hồ sơ.

`run/workflow-demo-active.json` chỉ đến lượt hiện tại. `browser-report.json` trong thư mục lượt đó ghi kết quả, các kiểm tra và ID hai hồ sơ; cùng thư mục có ảnh PNG và hai PDF tải qua giao diện. Báo cáo/ảnh chỉ nằm cục bộ, không đưa lên Git. Các lần khởi động tạo ID mới nên không ghi cố định ID vào tài liệu này.

Bốn kiểm thử rào chắn demo được chạy trong `test:recovery`, cùng 20 kiểm thử fixture và 126 kiểm thử sao lưu/phục hồi: tổng 150 kiểm thử đạt. Build API/Web đạt; 105 kiểm thử Web và lượt acceptance riêng 84 kiểm thử đạt. Đây là nghiệm thu cục bộ bằng dữ liệu giả, chưa phải nghiệm thu vận hành dữ liệu thật.
