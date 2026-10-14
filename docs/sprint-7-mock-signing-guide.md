# Hướng dẫn ký và đối chiếu mô phỏng

Chỉ dùng cho dữ liệu giả trong diễn tập Sprint 7. Mỗi kết quả đều mang nhãn **DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ**. Duyệt nội dung hồ sơ chưa phải cấp văn bản; đối chiếu khớp chưa phải xác minh chữ ký số.

## Cán bộ thực hiện

1. Nhận xử lý và hoàn tất duyệt nội dung hồ sơ theo quy trình hiện có.
2. Mở phiếu của lần gửi hiện tại, tải Word và PDF để hệ thống lưu bản tài liệu cố định.
3. Chọn **Kiểm tra tình trạng tài liệu**. Mục **Ký và đối chiếu mô phỏng** chỉ xuất hiện khi môi trường diễn tập đã bật tính năng.
4. Nếu được phân công đúng hồ sơ và có quyền ký mô phỏng riêng, chọn **Xem lại ký mô phỏng Word/PDF**.
5. Đọc thông tin, đánh dấu xác nhận, rồi chọn **Xác nhận ký mô phỏng Word/PDF**. Có thể hủy trước khi xác nhận.
6. Chọn **Đối chiếu mô phỏng Word/PDF** để kiểm tra byte tài liệu với kết quả đã lưu và xem lịch sử.

Quyền duyệt hồ sơ hoặc vai trò quản trị tự nó chưa đủ để ký mô phỏng. Lần gửi cũ, hồ sơ chưa duyệt/từ chối, tài khoản/đơn vị/thủ tục không hoạt động đều bị chặn. Giấy xác nhận sinh viên vẫn làm trực tiếp tại Phòng CTSV.

## Sinh viên xem kết quả

Mở hồ sơ của mình, chọn **Kiểm tra tình trạng tài liệu** tại phiếu của lần gửi cần xem. Khi đã có kết quả ký mô phỏng, sinh viên có thể đối chiếu và xem lịch sử; sinh viên không có nút ký.

- **Khớp byte và kết quả mô phỏng**: tài liệu khớp dữ liệu đã cố định trong hệ thống ở thời điểm kiểm tra. Trạng thái kỹ thuật vẫn `NOT_VERIFIED`, giá trị pháp lý vẫn `false`.
- **Không khớp, cần kiểm tra tài liệu**: người phụ trách phải kiểm tra nguyên nhân. Hệ thống giữ nguyên tài liệu gốc.
- **Quyền hoặc thông tin đã thay đổi**: tải lại trạng thái trước khi thao tác. Không gửi lại toàn bộ hồ sơ chỉ vì thao tác mô phỏng bị lỗi.

Word/PDF và minh chứng không được đóng thêm hình dấu hoặc chữ ký. Kết quả mô phỏng và lịch sử đối chiếu được lưu riêng, gắn với đúng tài liệu, người thao tác và lần gửi; thao tác lặp đúng yêu cầu không sinh thêm bản ghi.

## Diễn tập kỹ thuật

Chạy `npm run rehearse:sprint7 --workspace @student-service/api` sau khi build, dùng bộ chuyển PDF và trình duyệt thử nghiệm đã cấu hình như các diễn tập trước. Lệnh tạo dữ liệu giả mới, chạy kiểm tra qua giao diện, ghi bằng chứng trong `run/workflow-demo/<runId>/`, rồi dừng và gỡ cơ sở dữ liệu diễn tập do nó sở hữu. Đây là kiểm tra một lần, không phải lệnh mở máy chủ để dùng lâu dài.

Máy chủ ứng dụng mặc định chưa bật ký mô phỏng. Chưa kết nối nhà cung cấp ký số, chứng thư, khóa ký hoặc thẩm quyền ký thật. Khôi phục bản sao có schema receipt/check mới phải được nghiệm thu riêng trước khi dùng dữ liệu thật.
