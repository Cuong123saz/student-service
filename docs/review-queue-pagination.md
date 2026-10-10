# Phân trang và lọc hàng đợi

Cập nhật 10/10/2026. Theo [ADR 0007](adr/0007-review-queue-pagination.md), commit thiết kế56418e0 trước migration0019. Increment local; chưa production/nghiệm thu hoặc đóng Sprint4/5. Giấy xác nhận sinh viên vẫn OFFLINE tại CTSV.

## Sử dụng

Mở Tiếp nhận hồ sơ trong cổng cán bộ hoặc quản trị. Chọn một trong năm trạng thái, nhập tên/mã sinh viên hoặc tên thủ tục, chọn phân công rồi Áp dụng bộ lọc. Chỉ đổi ô nhập chưa làm thay đổi danh sách. Đổi trạng thái áp dụng các ô hiện tại và tải trang đầu. Xóa bộ lọc bỏ tìm kiếm/phân công, giữ nhóm trạng thái đang chọn.

- Tất cả trong phạm vi: mọi hồ sơ hiện được quyền xem, bao gồm observer theo ADR0006.
- Tôi đang xử lý: cán bộ hiện nhận hồ sơ chính là người đang đăng nhập; hồ sơ chỉ định nhưng chưa Nhận xử lý chưa nằm trong nhóm này.
- Chưa có người nhận: chưa có reviewer, kể cả hồ sơ chỉ định chưa được nhận mà tài khoản có quyền xem.

Tìm kiếm không phân biệt hoa/thường, có phân biệt dấu. Tên/mã và thủ tục là thông tin đã chốt khi gửi; không tìm trong nội dung bổ sung, lý do, minh chứng. %, _ và dấu gạch chéo ngược là ký tự thường. Tối đa 100 ký tự sau trim. Mỗi trang 20, có nút Tải thêm 20 hồ sơ; số Đang hiển thị chỉ là số đã tải theo bộ lọc, không phải tổng hệ thống.

Giữ thứ tự gửi đầu tiên sớm nhất, không đổi vị trí chỉ vì bổ sung hoặc bàn giao. Tải lại bắt đầu trang đầu. Lỗi tải thêm giữ danh sách trước và Thử lại đúng mốc; mất quyền/phiên xóa dữ liệu. Đổi tài khoản hoặc bộ lọc bỏ phản hồi trễ. Hàng đợi có thể biến động khi hồ sơ/quyền thay đổi; không phải ảnh chụp cố định giữa các lần tải.

## Hợp đồng và hiệu năng

GET /api/v1/{user|admin}/review-submissions nhận status,assignment,q,cursor, trả {items,nextCursor}; thay hợp đồng mảng50 cũ trên hai cổng local. Không nhận offset/limit do client chọn. Cursor có timestamp UTC6 chữ số và UUID, gắn người/bộ lọc đã chuẩn hóa; cursor không hợp lệ hoặc dùng với bộ lọc khác trả 400. Mỗi trang vẫn kiểm tra authority/visibility DB hiện tại trước seek/limit. Summary chỉ lấy trường cần hiển thị qua join, không lấy câu trả lời/procedure/history và không truy vấn từng dòng. Không tính tổng đếm.

Migration0019 chỉ thêm hai btree status/submitted_at/id và processing_unit_id/status/submitted_at/id. Không thay trạng thái, tài khoản/grant/cấu hình thủ tục. Số đo bên dưới là baseline trước chỉ mục text. Increment tiếp theo đã thêm [GIN và kiểm chứng tìm kiếm](review-search-performance.md) theo ADR0008, giữ nguyên hợp đồng và quyền; từ khóa ngắn/rộng vẫn có thể scan.

## Kiểm chứng

Đã đạt **496 kiểm thử**: 99 API unit, 259 API integration, 105 Web và 33 cổng ADR. Typecheck/lint API, format, build API/Web và diff check đạt. Các kiểm thử mới bao phủ mốc cùng timestamp/microsecond, tìm literal và injection, quyền/bộ lọc trước limit, cursor khác người/bộ lọc, thu hồi scope giữa các trang, HTTP hai cổng/param sai/cookie, lỗi tải thêm/thử lại đúng mốc và phản hồi trễ khi đổi filter hoặc phiên.

Demo dùng tài khoản giả bốn vai trò trên DB test localhost:5434 riêng. Dataset 10000 dòng summary hàng đợi gồm 8000 chờ tiếp nhận được xem, 1000 đang xử lý của reviewer, 1000 chờ tiếp nhận chỉ định riêng người khác bị ẩn. Đã đọc hết 8000 qua 400 trang, không lặp/bỏ sót; tìm chính xác hồ sơ cuối, wildcard literal và hồ sơ riêng bị ẩn đúng. Giao diện hai cổng đã thử lọc/tải 20→40/tìm về1/empty/mine, cùng các luồng gửi-bổ sung-bàn giao-quyết định-thông báo trước đó. Không lỗi JavaScript, không tràn ngang 375/768/1024/1440 px; ảnh desktop/mobile được xem kiểm tra. Dataset tải lớn chỉ phục vụ truy vấn summary, không giả nhận 10000 hồ sơ đã có đủ file/lịch sử nghiệp vụ.

Số đo một lượt tuần tự 400 request HTTP localhost bằng Playwright APIRequestContext sau seed/ANALYZE, cache đã ấm, không tải đồng thời:

| Mốc | Thời gian |
| --- | ---: |
| Trang đầu | 22.61 ms |
| Trang 200 | 18.53 ms |
| Trang 400 | 16.54 ms |
| Trung vị | 19.43 ms |
| P95 | 22.79 ms |
| Lớn nhất | 25.05 ms |

EXPLAIN ANALYZE/BUFFERS của truy vấn seek đại diện trang sâu dùng submissions_queue_unit_status_idx, lấy 21 dòng qua index; đây là phép đo SQL riêng, không thay thế thời gian HTTP/authority hoặc cam kết tải thực tế. Demo và dataset được dọn khỏi DB test, không đụng dữ liệu development.

Migration0019 đã áp dụng đúng một migration trên DB development localhost:5433/student_service, kiểm tra hash migration trước và đối chiếu giữ nguyên users/submissions/files/rounds/events/permissions/grants/notifications cùng cấu hình STUDENT_CONFIRMATION. API:3000/Web:3001 đã khởi động lại; trang hàng đợi hai cổng mở được, endpoint riêng trả 401 khi chưa đăng nhập.

Bằng chứng local (git ignore): run/queue-api-{full,typecheck,lint,build}.log, run/queue-web-{tests,build}.log, run/queue-adr-tests.log, run/queue-format.log, run/queue-browser-smoke.log (metrics/EXPLAIN), run/queue-dev-migration.log, run/queue-local-health.log và run/queue-*.png. Quy trình test chuẩn có thể chạy lại bằng các script npm trong repository; demo browser sử dụng runtime/đường dẫn cục bộ của máy này.

Các giới hạn còn lại: lịch sử nhiều lần gửi chưa phân trang; [đã thử tải đồng thời ngắn tối đa 20 phiên](concurrent-access-check.md), chưa có thử tải duy trì hoặc production SLA; backup/restore, lưu trữ tệp, retention/quét mã độc vẫn cần chuẩn bị vận hành theo ADR0003. Demo đúng chưa đủ cơ sở mở hệ thống cho dữ liệu thật.
