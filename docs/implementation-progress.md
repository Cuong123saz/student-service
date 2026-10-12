# Tiến độ triển khai và điểm tiếp tục

Cập nhật 11/10/2026. Đây là tiến độ mã nguồn/kiểm chứng local, không thay nghiệm thu của chủ dự án hoặc quy chế thực tế của Học viện. Sprint 2+3 giữ trạng thái CLOSED đã ghi nhận; Sprint 4 chưa tự đóng.

## Đã làm và kiểm chứng cục bộ

- Nền tảng tài khoản, hồ sơ sinh viên, khoa/lớp/cố vấn, RBAC theo phạm vi và quản trị/import/export.
- Cấu hình thủ tục có phiên bản: biểu mẫu đủ sáu kiểu trường, yêu cầu minh chứng, đơn vị/cán bộ/hàng đợi. Giấy xác nhận sinh viên OFFLINE tại CTSV.
- Nháp, minh chứng riêng tư, gửi và chốt từng round; nhận xử lý, yêu cầu bổ sung, duyệt nội dung/từ chối, bàn giao và thông báo trong ứng dụng. Quyền hiện tại được kiểm tra khi thao tác; lịch sử và tệp cũ giữ nguyên.
- Phiếu Word/PDF tự điền cho mọi loại hồ sơ điện tử, theo đúng round, chưa ký. Mẫu v1 khóa mã băm; từng round gắn id/hash/nguồn mẫu bất biến theo ADR0009. Round cũ gắn LEGACY_V1 rõ ràng, không fallback sang mẫu mới.
- Gói ZIP riêng từng round: Word, PDF, minh chứng nguyên byte, manifest kiểm tra toàn vẹn; công cụ kiểm tra ngoại tuyến và kiểm tra sẵn sàng Word/PDF. Đã kiểm chứng hai tác vụ đồng thời với gói nhỏ, từ chối tác vụ vượt mức và thử lại sau giải phóng; một hồ sơ đủ20MiB qua hợp đồng HTTP và PDF thật đạt; hai gói đủ20MiB đồng thời đạt trong profile Fastify inject/MemoryStorage, có kiểm tra cấu trúc PDF độc lập. Profile bổ sung dùng kho đĩa thật ổ D đạt; đọc minh chứng/mẫu/PDF có giới hạn trước cấp phát. Chưa đo gói lớn qua TCP hoặc tổng bộ nhớ máy.
- Nền tảng B2 có registry/job/lease và constraint/trigger append-only qua migration0023, repository quota chung, vault/coordinator lưu Word trước và chuyển PDF từ đúng byte đó, provenance thực và kiểm thử process death; mới áp vào test5434, chưa bật route trong development/demo.
- Đối chiếu toàn vẹn kho, thử khôi phục/đóng gói/mã hóa và demo bằng dữ liệu giả, runtime tách khỏi bản dựng đang phát triển. B1 của ADR0010 đã thêm recovery v2 giữ mẫu và output riêng; đã phục hồi Word/PDF thật từ archive mã hóa vào cluster mới. B2 bổ sung DATABASE_REGISTRY/staging, audit inventory, thu lease và chạy tiếp PDF từ Word cũ sau restore; vẫn chưa bật vault mặc định ở development/demo.

Chi tiết registry: [nền tảng B2](document-registry.md); [vault/coordinator](document-vault.md). Chi tiết phục hồi mới: [recovery v2](document-recovery-v2.md). Chi tiết và bằng chứng mới nhất: [phiếu Word/PDF](submission-documents.md), [gói tải](submission-bundles.md). Dữ liệu thực hành cũ ở 3011/3013 được giữ; bản gói mới ở `http://127.0.0.3:3015/login`, dùng DEMO 3 để tự thực hành.

Lượt B2 vault mới nhất: 143 unit đạt/1 skip Windows EPERM của test cũ, 292 integration, 22 storage, 20 fixture, 170 recovery/archive/encryption, 6 demo guard và7 verifier đạt; lượt riêng compiled runtime/LibreOffice thật đạt29 test. Typecheck/lint/build/format đạt. Word/PDF giữ nguyên byte qua tải lại, PDF lỗi giữ Word, process death ở ba điểm và hai process tranh một set đã được kiểm chứng; chưa coi là hoàn tất supervisor converter hoặc TCP/UAT. Phục hồi registry đã đạt ở lượt d8aabaca-f314-43a4-be43-0c59d571a02e: 29 bảng/4 sequence, 3 tài liệu+3 stage tại backup và PDF thứ4 sau resume, 68 HTTP request gồm từ chối dự kiến. Hồi quy recovery mới205 ca +20 fixture +6 demo guard đạt; xem [phục hồi registry](registry-recovery.md).

Lượt mở lượt có kiểm soát theo ADR0011/migration0024 đã hoàn thành trong môi trường thử: giữ attempts tăng dần, quyền riêng cùng role/scope, audit nguyên tử, replay và trần sáu lần. Diễn tập `f741a234-6dc1-4d3c-819f-51f8c3a182eb` đạt 30 bảng/4 sequence, phục hồi cả quyết định retry rồi tạo PDF lần5 từ đúng Word cũ; 77 HTTP request với các từ chối dự kiến. Kiểm thử mới: 144 unit đạt/1 skip cũ, 306 integration, 122 web, 213 recovery +20 fixture +6 demo guard, 44 ADR; schema không drift. Chi tiết: [mở thêm lượt](controlled-document-retry.md).

Lượt supervisor Windows đã đạt16 ca chuyên biệt với LibreOffice thật,158 unit/1 skip cũ,306 integration và38 ca compiled vault. Diễn tập mã hóa `a9f57c69-e85e-4767-9f23-e20b54c6a47e` đạt,30 bảng/4 sequence và PDF lần5 từ Word cũ. Bước --version cũng được giám sát; mất xác nhận thu process thì cách ly bộ chuyển. Chi tiết: [giám sát process](document-process-supervisor.md). Tiếp demo vault mới, chưa nâng development/demo cũ hoặc đóng B2/B3.

## Việc kế tiếp theo thứ tự

1. Tiếp B2 của ADR0010: nối vault/worker và route tải lại byte đã lưu. Registry/job/lease migration0023, repository, vault và coordinator đã có I/O và kiểm thử lưu/đọc lại; chưa thay renderer mặc định của route. Thiết kế và rào chắn ADR đã commit; B1 recovery v2/namespace/mã hóa/fault tests đạt. Phần A gắn mẫu với round đã xong; route hiện chưa lưu byte đầu ra. Process death/mất phản hồi ứng dụng và hai process tranh việc đã được thử trong database tạm. Recovery registry thật, audit/inventory/lease restore và tải qua API rehearsal riêng đã đạt. Retry vận hành có quyền/audit đã có kiểm chứng; supervisor Windows đã đạt; tiếp demo vault mới trước nâng development có backup/đối chiếu. Word công bố trước; PDF chuyển từ đúng Word đó để lỗi converter không chặn Word.
2. Sau nền tảng đó, triển khai mock signer phục vụ phát triển theo roadmap, kết quả ghi rõ mô phỏng; lưu kết quả xác minh kỹ thuật riêng với quyết định xét hồ sơ. Không dùng ảnh dấu/chữ ký để gán hợp lệ.
3. Muốn ký/phát hành thật cần mẫu chính thức, đơn vị ban hành, thẩm quyền/ủy quyền người ký, loại chữ ký bắt buộc và chính sách tin cậy của Học viện. Không suy ra thẩm quyền từ ADMIN hoặc quyền duyệt trong ứng dụng.
4. Trước dữ liệu thật: kiểm chứng backup trên thiết bị khác, retention, quét mã độc và tải với dung lượng/số người thực tế; hoàn tất nghiệm thu người dùng. Thời gian đo trên gói giả nhỏ không phải cam kết vận hành.

## Nguyên tắc giữ nguyên

Dùng dữ liệu giả khi thử. Không ghi đè template v1 hoặc file đã chốt. Lỗi tạo tài liệu không làm sinh viên gửi lại hồ sơ. Duyệt nội dung chưa phải phát hành; STUDENT_CONFIRMATION tiếp tục làm trực tiếp tại Phòng CTSV. Không tự kết luận chữ ký/hiệu lực pháp lý từ mã SHA-256.
