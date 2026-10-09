# Sprint 5: Kê khai bản nháp và minh chứng

Ngày: 09/10/2026. Trạng thái: increment local, Sprint 5 IN_PROGRESS. Không thay cho nghiệm thu Sprint 4, không phải triển khai production.

## Dùng thử

1. Quản trị mở **Biểu mẫu và nơi xử lý**, chọn một thủ tục thực sự được tiếp nhận ONLINE hoặc HYBRID, cấu hình trường và yêu cầu minh chứng rồi áp dụng phiên bản. ONLINE/HYBRID vẫn phải vượt qua kiểm tra cán bộ có quyền xét trong phạm vi đơn vị.
2. Sinh viên đã kích hoạt tài khoản, có lớp/khoa ACTIVE, đăng nhập và mở chi tiết dịch vụ đó. Chọn **Kê khai / tiếp tục bản nháp**.
3. Mã sinh viên, họ tên, mã lớp/khoa được lấy từ máy chủ theo cấu hình, không cho sửa trong bản nháp. Các trường sinh viên kê khai gồm văn bản, đoạn văn, số, ngày, lựa chọn và Có/Không.
4. Có thể **Lưu bản nháp** khi thiếu thông tin bắt buộc. **Xem lại thông tin** hiển thị câu trả lời hiện tại và các mục còn thiếu; chỉ rõ thay đổi chưa lưu.
5. Lưu thông tin trước khi tải/gỡ minh chứng. Chọn một PDF, PNG hoặc JPEG đúng loại, giới hạn từng mục và giới hạn tổng. Tệp chỉ được tải xuống qua phiên sinh viên sở hữu.
6. Mở **Cổng của tôi → Thủ tục của tôi** để tiếp tục các bản nháp. Danh sách hiện tối đa 50 bản cập nhật gần nhất.

Không đổi giấy xác nhận sinh viên sang ONLINE để thử chức năng: nghiệp vụ đã chốt của thủ tục này là làm việc trực tiếp tại CTSV. Nếu cần thử, tạo thủ tục giả định riêng có cấu hình hợp lệ.

## Quy tắc đã triển khai

- Một sinh viên có một nháp trên mỗi phiên bản biểu mẫu. Nhấn tạo nhiều lần trả lại cùng nháp.
- Lưu/tải/gỡ yêu cầu revision hiện tại. Hai phiên cùng sửa chỉ có một lần ghi thành công; xung đột giữ nội dung đang nhập. Nút tải bản lưu mới cập nhật revision nhưng giữ câu trả lời cục bộ để người dùng đối chiếu.
- Nháp giữ phiên bản và cấu hình công khai ban đầu. Phiên bản nghỉ, dịch vụ ngừng hoặc đơn vị ngừng thì nháp chỉ được xem; không tự chuyển dữ liệu sang biểu mẫu mới.
- Kiểm tra tài khoản ACTIVE, vai trò STUDENT và hồ sơ học vụ hiện tại trên mỗi thao tác. Không dùng riêng role trong cookie để cấp quyền. Hồ sơ/tệp của sinh viên khác trả 404.
- Origin của thao tác ghi phải khớp CORS_ORIGIN. Mỗi lần tải một tệp, tối đa 5 MiB; số lượng/dung lượng theo cấu hình, tổng tối đa 20 MiB. Máy chủ kiểm tra giới hạn dưới khóa và kiểm tra sơ bộ nội dung/loại/đuôi tệp; không chỉ tin tên tệp.
- Giữ nguyên byte gốc, lưu SHA-256 và kiểm tra toàn vẹn khi tải xuống. Tên lưu là UUID, không dùng tên người dùng cung cấp làm đường dẫn. Phản hồi tải xuống dùng attachment, private/no-store và nosniff.
- Gỡ minh chứng chỉ đánh dấu bỏ khỏi nháp, không xóa byte gốc. Tệp gỡ không được tải xuống bằng API.
- Lưu dữ liệu và audit trong một transaction; audit chỉ ghi định danh/revision/fileId, không ghi câu trả lời hoặc khóa kho tệp. Quản trị có thể lọc bốn hành động tạo/lưu nháp, tải/gỡ minh chứng.
- Khi tải thất bại, chỉ dọn tệp mới sau khi khóa đồng bộ trong database xác nhận không có metadata tham chiếu. Nếu mất phản hồi commit hoặc database không kiểm tra được, giữ nguyên tệp và trả 503 để kiểm tra lại, tránh xóa nhầm minh chứng đã lưu.
- Mọi tệp có signatureStatus = NOT_CHECKED. SHA-256 kiểm tra byte không đổi, không chứng minh chữ ký số hợp lệ. Ảnh dấu đỏ/chữ ký không được tự chuyển thành kết quả VALID.

## API sinh viên

Tất cả dưới /api/v1/user; cookie phiên sinh viên, thao tác ghi thêm Origin.

| Method | Đường dẫn                                    | Kết quả                                                      |
| ------ | -------------------------------------------- | ------------------------------------------------------------ |
| GET    | /submissions                                 | Danh sách nháp của mình, tối đa 50                           |
| POST   | /submissions                                 | Tạo/lấy nháp, body serviceId + versionId                     |
| GET    | /submissions/:id                             | Thông tin, cấu hình, minh chứng, mục còn thiếu               |
| PUT    | /submissions/:id                             | Lưu body expectedRevision + values, chỉ trường STUDENT_INPUT |
| POST   | /submissions/:id/attachments/:key?revision=N | Multipart một phần file                                      |
| DELETE | /submissions/:id/files/:fileId?revision=N    | Gỡ khỏi nháp                                                 |
| GET    | /submissions/:id/files/:fileId               | Tải byte gốc, kiểm tra owner và hash                         |

401: thiếu/hết phiên; 403: sai quyền/Origin/hồ sơ không đủ điều kiện; 404: không tìm thấy trong phạm vi sở hữu; 409: nháp thay đổi hoặc cấu hình không còn cho sửa; 413: vượt giới hạn tải; 422: dữ liệu/tệp sai; 503: cần đối chiếu kết quả lưu hoặc toàn vẹn tệp. JSON false, 0 và null được giữ nguyên, không ép thành chuỗi.

## Kho tệp và giới hạn vận hành

SUBMISSION_STORAGE_ROOT là biến tùy chọn của API, nên là đường dẫn tuyệt đối đến kho riêng. Mặc định .local/submission-files tính từ thư mục chạy API; npm workspace chạy ở apps/api. Kho .local được bỏ qua trong Git và không có route tĩnh công khai.

Adapter hiện dùng ổ đĩa local. Trước môi trường dùng chung cần kho bền vững, phân quyền vận hành, backup/retention và quét mã độc. Kiểm tra header tệp hiện tại không phải quét virus, kiểm tra đầy đủ cấu trúc PDF/ảnh hay xác minh chữ ký. Khi database lỗi có thể còn tệp chưa liên kết; cần đối chiếu an toàn trước khi dọn, không xóa tự động chỉ dựa vào một lần truy vấn lỗi.

Chưa có nút gửi hồ sơ, hàng đợi xét, trả/bổ sung hồ sơ, sinh giấy chính thức, DOCX/PDF kết quả hoặc tích hợp nhà cung cấp chữ ký. Những phần này là increment tiếp theo. Giấy xác nhận sinh viên tiếp tục OFFLINE.

Thiết kế: [ADR 0003](adr/0003-student-drafts-and-evidence.md), [chính sách hồ sơ điện tử](adr/0002-electronic-document-validation.md).

## Kiểm chứng increment local

Thực hiện trên Node 22.23.2, PostgreSQL local; migration 0015 đã áp dụng cho database test và development, giữ nguyên dữ liệu/cấu hình development.

| Kiểm tra                                   | Kết quả                                     |
| ------------------------------------------ | ------------------------------------------- |
| API unit                                   | 94/94                                       |
| API integration                            | 184/184                                     |
| Web                                        | 41/41                                       |
| Nuxt acceptance                            | 20/20, là tập con của 41, không cộng hai số |
| ADR gate tests                             | 21/21                                       |
| Typecheck API, lint, format, build API/Web | Đạt                                         |

Các ca mới gồm quyền sở hữu, role/status hiện tại, cấu hình OFFLINE, phiên bản cũ chỉ xem, race tạo/lưu/tải, giới hạn 4 lượt tải bao gồm cả thời gian chờ lưu và trả lượt khi hoàn tất/thất bại, giới hạn từng tệp/tổng, JSON false/0/null, 50 trường tiếng Việt đạt độ dài tối đa, dữ liệu sai, Origin/multipart, download riêng, hash sai, gỡ mềm, rollback audit và mất phản hồi commit/database không sẵn sàng.

Demo trình duyệt dùng tài khoản và thủ tục giả định trong database test riêng, máy chủ test cổng 3010/3011: đăng nhập thật → tạo/tiếp tục → lưu thiếu thông tin → sáu kiểu trường → xem lại/focus → hai phiên xung đột giữ nội dung → lưu/tải byte gốc → tải lại trang/danh sách. Kiểm tra OFFLINE không hiện nút kê khai; 375/768/1024/1440 px không tràn ngang; không có lỗi JavaScript. Dữ liệu demo và kho tệp thử được dọn sau kiểm tra.

Rà soát độc lập tập trung vào quyền sở hữu/role/status, Origin, revision, giới hạn tệp, byte/hash, đối chiếu commit và che dữ liệu nhạy cảm. Đã sửa lỗi trả lượt tải trước khi lưu xong; ca HTTP hồi quy thất bại trên mã cũ và đạt sau sửa. Lần chạy lại đạt 184/184 integration; kiểm tra kiểu dữ liệu, lint và build API được cập nhật ở các log có hậu tố reviewed. Các kiểm tra Web và trình duyệt ở trên giữ kết quả của bản giao diện không đổi.

Bằng chứng local, được bỏ qua trong Git: run/sprint5-api-tests-final.log, run/sprint5-web-tests-final.log, run/sprint5-adr-tests-final.log, run/sprint5-api-quality-final.log, run/sprint5-format-final.log, run/sprint5-build-final.log, run/sprint5-browser-smoke.log, run/sprint5-api-integration-reviewed.log, run/sprint5-api-quality-reviewed.log, run/sprint5-api-build-reviewed.log; ảnh run/sprint5-student-1440.png và run/sprint5-student-375.png. Web đang chạy bản mới tại http://localhost:3001; API tại http://localhost:3000. Chưa tạo/áp dụng cấu hình nghiệp vụ mới trên development hoặc đổi thông tin đăng nhập.
