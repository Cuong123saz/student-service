# Gửi hồ sơ và tiếp nhận xử lý

Mốc kiểm chứng lịch sử: 10/10/2026. Increment gửi/tiếp nhận đã có local; theo kế hoạch hợp nhất, xét duyệt theo dõi ở Sprint 6. [Đóng Sprint 5](sprint-5-closure.md) chỉ xác nhận tự điền/nháp/upload/xem trước, không tự đóng Sprint 6 hoặc nghiệm thu production.

## Dùng thử

1. Quản trị cấu hình một thủ tục thực sự tiếp nhận ONLINE/HYBRID, có đơn vị và cán bộ đủ quyền, rồi áp dụng biểu mẫu. Dùng thủ tục giả định riêng để thử; giấy xác nhận sinh viên giữ OFFLINE và liên hệ trực tiếp CTSV.
2. Sinh viên kê khai, lưu và tải đủ minh chứng. Lưu thiếu thông tin vẫn được, gửi hồ sơ phải đủ các mục bắt buộc.
3. Chọn **Xem lại thông tin**, kiểm tra nội dung đã lưu, đánh dấu xác nhận rồi **Gửi hồ sơ**. Thay đổi chưa lưu hoặc thiếu mục bắt buộc sẽ chặn gửi.
4. Hồ sơ chuyển **Đã gửi · Chờ tiếp nhận**. Nội dung/minh chứng được khóa; sinh viên đọc, tải byte gốc và theo dõi ở **Thủ tục của tôi**.
5. Cán bộ đăng nhập cổng người dùng, mở **Tiếp nhận hồ sơ**. Tài khoản quản trị đủ quyền cũng có mục này trong quản trị. Hàng đợi chỉ hiện hồ sơ đã gửi đúng phạm vi; bản nháp không xuất hiện.
6. Mở hồ sơ, đối chiếu nội dung/minh chứng và chọn **Nhận xử lý**. Trạng thái chuyển **Đang xử lý**, ghi nhận người và thời gian nhận. Nhận xử lý chưa phải kết quả duyệt hoặc ký.

Hàng đợi hiện có năm nhóm trạng thái, tải từng trang20 hồ sơ theo thời gian gửi đầu tiên sớm nhất. Có tìm tên/mã sinh viên hoặc thủ tục và lọc phân công; xem [hướng dẫn phân trang](review-queue-pagination.md). Số đang hiển thị không phải tổng số hồ sơ toàn hệ thống. Quyền xét và phạm vi phải thuộc cùng một role assignment; ORGANIZATION đúng đơn vị hoặc GLOBAL. Hồ sơ chỉ định cán bộ cụ thể chỉ người đó được tiếp nhận, kể cả khi người khác có GLOBAL. Không tự xử lý hồ sơ của chính mình.

## Điều gì được chốt khi gửi

Máy chủ dùng bản đã lưu và revision hiện tại, cập nhật thông tin hồ sơ học vụ, kiểm tra các trường/minh chứng bắt buộc, định dạng/giới hạn và byte/SHA-256 của tệp gốc. Thời gian gửi, đơn vị, người được chỉ định và bốn thông tin sinh viên (mã, họ tên, lớp, khoa) được chốt cùng transaction với audit.

Sau gửi không sửa câu trả lời, cấu hình, thông tin chốt hoặc danh sách minh chứng; database trigger bảo vệ thêm nội dung và tệp. Nhận xử lý chỉ cập nhật trạng thái, người nhận, thời gian và revision. Phiên bản biểu mẫu nghỉ hoặc dịch vụ ngừng sau gửi không làm mất công việc đã tiếp nhận; quyền hiện tại và đơn vị ACTIVE vẫn được kiểm tra.

Gửi lại hồ sơ đã gửi hoặc nhận lại của đúng người đã nhận không tạo sự kiện trùng. Hai người nhận cùng lúc chỉ một người thành công. Khi xung đột, tải lại trạng thái để đối chiếu; nội dung đang nhập được giữ. Nếu hồ sơ đã được gửi từ tab khác, phần xem lại hiển thị đúng nội dung đã gửi, phần cục bộ khác biệt được giữ riêng và ghi rõ chưa thuộc hồ sơ đã gửi.

Khi mạng hoặc máy chủ không trả kết quả gửi rõ ràng, giao diện yêu cầu kiểm tra trạng thái trước khi thử tiếp. Không tự kết luận “chưa gửi” rồi tạo hồ sơ mới.

## API

- POST /api/v1/user/submissions/:id/submit với expectedRevision.
- GET /api/v1/{user|admin}/review-submissions?status=SUBMITTED|IN_REVIEW: hàng đợi theo quyền và nhóm; bỏ query trả cả hai nhóm theo thời gian gửi.
- GET /api/v1/{user|admin}/review-submissions/:id: nội dung đã gửi.
- POST /api/v1/{user|admin}/review-submissions/:id/claim với expectedRevision.
- GET /api/v1/{user|admin}/review-submissions/:id/files/:fileId: tệp gốc sau kiểm tra quyền và toàn vẹn.

Phiên user/admin tách riêng; bắt buộc đổi mật khẩu chưa được thao tác. Mỗi lần đọc/ghi kiểm tra lại quyền/tình trạng tài khoản ở database; ngoài phạm vi không lộ hồ sơ. Origin được kiểm tra khi ghi. DTO không có storageKey hoặc UUID phân công riêng; audit chỉ ghi định danh/trạng thái, không câu trả lời hoặc byte tệp.

## Giới hạn increment

Chưa có duyệt, từ chối, trả/bổ sung, phân công lại, email thông báo, sinh văn bản, chữ ký số, trả kết quả hoặc production. Các tệp vẫn **Chữ ký chưa được xác minh**; nhận hồ sơ hoặc kiểm tra SHA-256 không chứng minh hiệu lực chữ ký/dấu đỏ.

Kho tệp local còn các điều kiện bảo vệ, backup/retention và quét mã độc đã ghi ở [ADR 0003](adr/0003-student-drafts-and-evidence.md). Giấy xác nhận sinh viên vẫn xử lý trực tiếp tại CTSV.

Thiết kế: [ADR 0004](adr/0004-submission-and-intake.md), được commit riêng 602cb4a trước migration 0016. Phần nháp trước đó: [Sprint 5 bản nháp/minh chứng](sprint-5-drafts.md).

## Kiểm chứng

Kiểm chứng ngày 10/10/2026 trên Node 22.23.2 và PostgreSQL local. Migration 0016 chạy từ đầu trên database test, sau đó áp dụng bổ sung vào development; giữ nguyên tài khoản, hồ sơ và cấu hình giấy xác nhận sinh viên. Không reset dữ liệu development hoặc thay thông tin đăng nhập.

| Kiểm tra                                             | Kết quả                                     |
| ---------------------------------------------------- | ------------------------------------------- |
| API unit                                             | 95/95                                       |
| API integration toàn dự án                           | 223/223                                     |
| Integration riêng module hồ sơ                       | 54/54, là tập con của 223                   |
| Web (gồm Nuxt acceptance)                            | 65/65, 13 tệp                               |
| ADR gate tests                                       | 22/22                                       |
| Typecheck API, lint, format toàn repo, build API/Web | Đạt                                         |
| ADR Accepted trước migration                         | Đạt; kiểm tra lại sau commit implementation |

Các ca mới kiểm tra đủ trường và minh chứng; false/0; profile và quyền bị đổi trong thời gian đọc tệp; scope/permission cùng role; chỉ định cán bộ kể cả GLOBAL; chặn tự xử lý; tách phiên user/admin; Origin; lọc trạng thái trước giới hạn 50; tệp gốc/size/hash; đồng thời gửi-lưu-tải-publish và hai cán bộ cùng nhận; retry không tạo audit trùng; audit lỗi rollback; trigger chặn sửa nội dung, chuyển binding và minh chứng bằng SQL; lỗi không lộ câu trả lời hoặc storage key.

Demo trình duyệt dùng ba tài khoản và thủ tục giả định trên database test riêng, cổng 3010/3011: sinh viên đăng nhập thật → lưu thiếu → đủ sáu kiểu trường → hai tab xung đột giữ nội dung → tải/tải xuống byte gốc → xem lại/xác nhận/gửi. Bài thử cố ý ngắt phản hồi sau khi máy chủ đã commit gửi; giao diện khóa sửa và buộc GET tra trạng thái, sau đó nhận đúng SUBMITTED. Retry không lặp gửi; cán bộ đăng nhập thật → hàng đợi → chi tiết/tệp gốc → nhận xử lý; quản trị đăng nhập riêng → nhóm Đang xử lý → chi tiết/tệp gốc; sinh viên tải lại thấy trạng thái và nội dung đã khóa. Cookie sai cổng bị từ chối. Thủ tục OFFLINE chỉ hướng dẫn CTSV.

Đã kiểm tra 375/768/1024/1440 px cho ba màn hình chi tiết, không tràn ngang hoặc lỗi JavaScript; xem ảnh desktop/mobile. Dữ liệu tài khoản/thủ tục giả và kho tệp demo được dọn sau thử. Rà soát độc lập không thấy lỗi mới có căn cứ trong diff cuối; trước đó đã sửa bảo vệ binding khi gửi, kiểm tra lại profile/quyền sau I/O và nút đang tải bị ghi đè disabled.

Bằng chứng local được bỏ qua trong Git: run/intake-api-{unit,integration,targeted,typecheck,lint,build}.log, run/intake-web-{tests,build}.log, run/intake-adr-tests.log, run/intake-format.log, run/intake-browser-smoke.log, run/intake-dev-migration.log và run/intake-local-health.log. Ảnh run/intake-{student,reviewer,admin}-{1440,375}.png. Kịch bản demo run/intake-smoke.mjs chứa dữ liệu giả, chỉ chạy được với database test localhost:5434/student_service_test.

Ở mốc kiểm chứng 10/10, bản local đã chạy tại localhost:3001, API localhost:3000; đây không phải trạng thái máy chủ hiện tại; kiểm tra API công khai 200, API hồ sơ chưa đăng nhập 401 và các trang mới tải được. Không dùng kết quả nghiệm thu Sprint 4 hoặc số liệu bản nháp lịch sử để thay bằng chứng của bước gửi/nhận.

## Increment bổ sung và quyết định

Bước [bổ sung và quyết định xử lý](submission-resolution.md) được triển khai tiếp theo yêu cầu chủ dự án. Phạm vi và số liệu kiểm chứng phía trên thuộc increment gửi/tiếp nhận; không thay bằng chứng cho bước mới. Chưa ký/cấp văn bản; giấy xác nhận sinh viên giữ OFFLINE.
