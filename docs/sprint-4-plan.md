# Sprint 4 — Cấu hình biểu mẫu và nơi xử lý

Ngày cập nhật: 14/10/2026. Trạng thái: **CLOSED trong phạm vi kỹ thuật local theo ủy quyền của chủ dự án**. Yêu cầu “tự haonf thành tới khi xong sprint 4” là căn cứ ghi nhận hoàn tất; không ghi chữ ký nghiệm thu hoặc phê duyệt của Học viện. Xem [hồ sơ đóng](sprint-4-closure.md) và [trạng thái JSON](sprint-4-status.json).

## Quyết định nghiệp vụ

Chủ dự án yêu cầu cấu hình biểu mẫu, đơn vị và người xử lý theo thực tế. Giấy xác nhận sinh viên hiện được xử lý trực tiếp tại Phòng CTSV. Cấu hình mặc định khi tạo nháp là OFFLINE, không bắt buộc cố vấn hoặc cán bộ xét duyệt online.

[ADR 0001](adr/0001-submission-workflow.md) đã Accepted trong commit 8df0347, trước migration mới. Sprint 2+3 có trạng thái CLOSED trong base. Nhánh triển khai: feat/procedure-configuration. Bản Word kế hoạch do người dùng cung cấp được giữ nguyên.

## Quyết định cho hồ sơ điện tử

Ngày 09/10/2026, chủ dự án chấp nhận [ADR 0002: Xác minh chữ ký và chấp nhận hồ sơ điện tử](adr/0002-electronic-document-validation.md). Kết quả xác minh kỹ thuật và quyết định xét hồ sơ phải được lưu riêng; ảnh chữ ký/dấu đỏ không thay cho xác minh chữ ký số. Quyền xét và quyền ký ban hành là hai quyền riêng.

Giấy xác nhận sinh viên tiếp tục OFFLINE tại CTSV. Chức năng phát hành điện tử chỉ được triển khai sau khi có căn cứ về mẫu, thẩm quyền ký, loại chứng thư, chữ ký bắt buộc và quy trình của Học viện. Đây là quyết định thiết kế cho bước tiếp theo; chưa triển khai upload, xác minh, xét hoặc ký và không thay cho nghiệm thu đóng Sprint 4.

## Phần đã triển khai

| Hạng mục              | Kết quả                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Cấu hình có phiên bản | Một aggregate JSON có schema trong procedure_versions; mỗi dịch vụ có tối đa một nháp và một bản đang áp dụng        |
| Hình thức thực hiện   | OFFLINE, ONLINE, HYBRID; chọn đơn vị, cán bộ cụ thể hoặc phân công nội bộ                                            |
| Biểu mẫu              | Sáu kiểu trường; dữ liệu sinh viên khai hoặc nguồn hồ sơ theo allowlist; bắt buộc, độ dài, lựa chọn                  |
| Minh chứng            | Khai báo tên, loại file, số lượng và giới hạn; chưa tải file thật                                                    |
| Quản trị              | Tạo nháp, sửa, xem trước, kiểm tra, áp dụng; clone thành phiên bản mới                                               |
| Phân quyền            | Permission và scope phải thuộc cùng role; GLOBAL khởi tạo, ORGANIZATION duy trì cấu hình của đơn vị sở hữu           |
| An toàn cập nhật      | expectedRevision, khóa theo dịch vụ; conflict giữ dữ liệu đang nhập                                                  |
| Lịch sử               | Nội dung đã áp dụng không sửa/xóa; áp dụng bản mới và nghỉ bản cũ cùng transaction với audit                         |
| Trang sinh viên       | Đọc bản PUBLISHED của dịch vụ và đơn vị ACTIVE; OFFLINE hiển thị hướng dẫn trực tiếp, không yêu cầu đăng nhập để xem |

ONLINE/HYBRID phải có cán bộ ACTIVE có quyền submission.review trong phạm vi đơn vị, hoặc GLOBAL. Đây là kiểm tra tính hợp lệ của cấu hình; chưa có hàng đợi xét duyệt hoặc nộp hồ sơ online. OFFLINE có thể không chọn cán bộ cụ thể.

## Kiểm chứng lịch sử ngày 09/10/2026

Các số liệu sau là mốc triển khai đầu. Kết quả cuối ngày13/10 nằm trong [hồ sơ đóng](sprint-4-closure.md).

Chạy bằng Node 22.23.2 và PostgreSQL 17:

- Cổng ADR: 19/19.
- API unit: 90/90.
- Integration tập trung cấu hình: 16/16, gồm race create/update/publish, scope cùng role, cán bộ hợp lệ, immutable và rollback audit.
- Hồi quy integration cuối: 169/169, gồm CORS preflight PUT. Xem [bằng chứng triển khai](procedure-configuration.md).
- Web: 35/35; tập acceptance Nuxt 14/14 là tập con được chạy lại, không cộng hai số này. Có bảy ca mới cho cấu hình sử dụng mock API.
- Typecheck API, lint, format và API/Web build đạt.
- Migration được chạy trên test database sạch và áp dụng vào development local; giữ nguyên dữ liệu cũ.
- Bước dọn test dùng TRUNCATE trong database kiểm thử có guard, giữ nguyên trigger bảo vệ audit ở môi trường thật.

Demo trình duyệt Web → API → PostgreSQL và trạng thái cuối được ghi tại [hướng dẫn cấu hình](procedure-configuration.md). Test có mock và demo toàn luồng là hai loại bằng chứng khác nhau.

## Increment tiếp theo

[Kê khai bản nháp và minh chứng Sprint 5](sprint-5-drafts.md) đã được triển khai tiếp theo theo yêu cầu chủ dự án. Các câu “chưa upload” và số liệu ở trên mô tả phạm vi Sprint 4 tại thời điểm nghiệm thu, không phải trạng thái chức năng toàn dự án hiện tại. Sprint4 đã đóng kỹ thuật theo ủy quyền; nghiệm thu vận hành được ghi riêng khi có bằng chứng.

## Điều kiện đóng sprint

Cấu hình, giao diện, quyền/scope, phiên bản và audit đạt hồi quy cùng diễn tập thật trên dữ liệu giả. Ngày14/10 ghi nhận hoàn tất kỹ thuật theo yêu cầu tự hoàn thành của chủ dự án; chưa có biên bản chủ dự án tự thao tác nghiệm thu riêng. Chưa triển khai production. Nộp hồ sơ/upload/review/Word/PDF/ký thuộc các sprint sau; xem [tiến độ](implementation-progress.md). Không dùng kết quả Sprint3 thay bằng chứng Sprint4.
