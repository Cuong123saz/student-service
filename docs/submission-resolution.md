# Bổ sung và quyết định xử lý hồ sơ

Cập nhật 10/10/2026. Đã hoàn tất và kiểm chứng increment local theo [ADR 0005](adr/0005-submission-resolution.md), đã Accepted và commit 0e21210 trước migration 0017. Chưa nghiệm thu/production hoặc đóng Sprint 4. Giấy xác nhận sinh viên vẫn OFFLINE, làm trực tiếp tại Phòng CTSV.

## Cán bộ xử lý

1. Mở Tiếp nhận hồ sơ, nhận một hồ sơ thuộc quyền/phạm vi của mình.
2. Đọc lần gửi gần nhất và minh chứng. Chọn yêu cầu bổ sung, duyệt nội dung hoặc không chấp thuận theo các quyền được cấp.
3. Ghi lý do cụ thể để sinh viên biết cần làm gì hoặc hiểu kết quả. Lý do bắt buộc 1–2000 ký tự sau khi bỏ khoảng trắng hai đầu.
4. Xem lại, xác nhận rồi ghi quyết định. Hai cán bộ thao tác đồng thời chỉ một thay đổi thành công; người cùng phạm vi không được quyết định thay người đã nhận.

Duyệt nội dung dùng submission.review; yêu cầu bổ sung và không chấp thuận cần thêm submission.reject trên cùng role assignment có scope phù hợp. ADMIN không tự có quyền. Các nút do quyền hiện tại của máy chủ quyết định; máy chủ kiểm tra lại khi ghi.

Hàng đợi có năm nhóm riêng: Chờ tiếp nhận, Đang xử lý, Chờ bổ sung, Đã duyệt nội dung, Không chấp thuận. [Phân trang và bộ lọc](review-queue-pagination.md) tải20 hồ sơ mỗi lần, có thể tải tiếp; quyền và bộ lọc thực hiện trước giới hạn, không phải tổng số hồ sơ hệ thống.

## Sinh viên bổ sung

1. Trong Thủ tục của tôi, mở hồ sơ Chờ bổ sung và đọc yêu cầu.
2. Sửa nội dung kê khai, lưu, tải/gỡ minh chứng của bản làm việc. Lưu thiếu vẫn được, gửi lại phải đủ yêu cầu. Không sửa thông tin PROFILE do máy chủ quản lý.
3. Xem lại bản đã lưu, đánh dấu xác nhận và Gửi bổ sung. Hồ sơ quay về Đang xử lý cho đúng cán bộ đã nhận.

Mỗi lần gửi tạo một bản chốt riêng; bản và tệp gốc của lần gửi trước vẫn đọc/tải được trong lịch sử. Gỡ tệp khỏi bản đang bổ sung không xóa byte gốc hoặc làm mất minh chứng của lần gửi cũ. Cán bộ chỉ thấy lần gửi mới nhất đã chốt; không thấy câu trả lời hoặc tệp sinh viên đang sửa dở.

Biểu mẫu/tuyến xử lý dùng bản đã chốt cho hồ sơ, kể cả khi biểu mẫu đã nghỉ hoặc dịch vụ tạm ngừng sau lần gửi đầu. Đơn vị phải ACTIVE. Nếu người đã nhận mất quyền, gửi bổ sung bị chặn và hướng dẫn liên hệ đơn vị; hệ thống chưa tự phân công lại.

## Lịch sử và quyết định

Lịch sử tách diễn biến xử lý (ai, khi nào, lý do) với các lần gửi (thông tin sinh viên, câu trả lời và minh chứng tại thời điểm gửi). Các hồ sơ có trước migration được chốt lại thành lần 1 có nguồn MIGRATION theo dữ liệu thực tế; không dựng lại thao tác trước đó khi thiếu chứng cứ.

Khi mất phản hồi hoặc xung đột, tải lại trạng thái trước khi tiếp tục; nội dung/lý do đang nhập được giữ. Retry cùng người, revision, hành động và lý do không tạo sự kiện/audit trùng; thay lý do/hành động cùng revision cũ trả 409.

APPROVED/REJECTED kết thúc xử lý trong increment này, chỉ xem và không mở lại. **Đã duyệt nội dung chưa phải cấp văn bản hoặc xác minh chữ ký**. Tệp tiếp tục Chữ ký chưa được xác minh; ảnh dấu đỏ hoặc chữ ký trên ảnh không được coi là kết quả xác minh chữ ký số.

## API mở rộng

- POST /api/v1/{user|admin}/review-submissions/:id/resolve với expectedRevision, action REQUEST_SUPPLEMENT|APPROVE|REJECT và note.
- POST /api/v1/user/submissions/:id/submit gửi nháp hoặc gửi bổ sung, vẫn dùng expectedRevision.
- GET queue thêm nhóm NEEDS_SUPPLEMENT|APPROVED|REJECTED.
- GET /api/v1/user/submissions/:id/rounds/:roundNumber/files/:fileId tải tệp của lần gửi cho owner.
- GET /api/v1/{user|admin}/review-submissions/:id/rounds/:roundNumber/files/:fileId tải tệp lịch sử cho cán bộ đúng quyền/phạm vi.

DTO lịch sử không storageKey/UUID người phân công. Tải tệp kiểm tra quyền trước/sau đọc, byte/size/hash và private/no-store/nosniff. Ghi quyết định/round/event/audit cùng transaction; lỗi rollback toàn bộ. Lý do nằm trong hồ sơ riêng, không ghi vào audit chung.

## Giới hạn và kiểm chứng

Chưa có email thông báo, sinh/ ký văn bản, cấp kết quả, phân công lại, thu hồi/mở lại quyết định hoặc production. Kho local còn các điều kiện backup, retention và quét mã độc của ADR 0003. Lịch sử local hiện trả tất cả lần gửi; cần phân trang trước quy mô lớn.

Kiểm chứng trên thay đổi cuối ngày 10/10/2026:

- API: 95/95 unit và 243/243 integration. Nhóm 74 kiểm thử hồ sơ/migration là tập con của integration, không cộng thêm. Kiểm tra kiểu, lint và build đạt.
- Giao diện: 87/87 kiểm thử trong 13 tệp và build đạt. Bộ kiểm tra thiết kế trước migration đạt 28/28; toàn bộ mã nguồn qua format:check và diff --check.
- Migration: tạo database tạm có chặn tên/địa chỉ, áp dụng đến 0016, tạo DRAFT/SUBMITTED/IN_REVIEW kèm tệp rồi chạy 0017. Kiểm chứng backfill đúng thông tin/thời điểm/byte metadata, nguồn MIGRATION, không dựng sự kiện; lịch sử không sửa/xóa và tệp đang bổ sung chỉ soft-remove. Database tạm được dọn sau kiểm chứng.
- Demo trình duyệt đăng nhập thật bằng ba tài khoản giả định trên database test riêng: hai vòng yêu cầu/gửi bổ sung; cán bộ không thấy bản sửa dở hoặc tệp mới chưa gửi; tệp lần đầu vẫn tải đúng byte sau khi thay. Gửi lại dùng biểu mẫu đã nghỉ và dịch vụ đã tạm ngừng vẫn về cùng cán bộ theo bản cấu hình đã chốt.
- Demo quyết định duyệt bị mất phản hồi sau khi máy chủ đã ghi: giao diện khóa và GET khôi phục; retry đúng không tạo sự kiện trùng, đổi lý do với revision cũ trả 409. Nhánh không chấp thuận hiển thị lý do và chỉ đọc cho sinh viên. Hàng đợi, tải tệp lịch sử và tách phiên user/admin đạt.
- Các trang sinh viên/cán bộ/quản trị được kiểm tra ở chiều rộng 375/768/1024/1440, không tràn ngang hoặc lỗi JavaScript; đã xem ảnh desktop/mobile. Thủ tục OFFLINE chỉ hướng dẫn đến CTSV. Rà soát độc lập không còn lỗi chặn cụ thể.
- Bản cục bộ đã áp dụng duy nhất migration 0017 sau khi kiểm tra hash migration trước. Số tài khoản/hồ sơ/tệp và cấu hình STUDENT_CONFIRMATION được đối chiếu trước/sau, không thay đổi. API công khai trả 200, API hồ sơ chưa đăng nhập trả 401; các trang mới tải được.

Bằng chứng local được bỏ qua trong Git: run/resolution-api-{unit,integration,targeted,typecheck,lint,build}.log, run/resolution-web-{tests,build}.log, run/resolution-adr-tests.log, run/resolution-format.log, run/resolution-browser-smoke.log, run/resolution-dev-migration.log và run/resolution-local-health.log. Ảnh run/resolution-{student,reviewer,admin}-{1440,375}.png, run/resolution-rejected-student-375.png và ảnh bản đang bổ sung. Kịch bản run/resolution-smoke.mjs chỉ chạy với database test localhost:5434/student_service_test, dùng dữ liệu giả và dọn môi trường riêng.

Bản local chạy tại http://localhost:3001, API http://localhost:3000. Đây là bằng chứng của increment bổ sung/quyết định; không tái dùng nghiệm thu Sprint 4, không đóng sprint hoặc tuyên bố sẵn sàng production.
