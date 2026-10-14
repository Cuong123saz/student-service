# Đóng Sprint 6 — Xét hồ sơ và tài liệu

Ngày 14/10/2026. **CLOSED kỹ thuật local**, theo ủy quyền “triển khai đến khi xong sprint 6”. Codex kiểm chứng và hoàn tất theo yêu cầu này. Chưa có biên bản chủ dự án tự thao tác nghiệm thu riêng hoặc phê duyệt Học viện. Production **NOT_READY**. [Trạng thái riêng](sprint-6-status.json) không thay trạng thái Sprint 2+3, 4, 5.

## Phạm vi và kết quả

Kế hoạch hợp nhất của chủ dự án xác định Sprint 6 là **Review và document: task xét duyệt, trả lại, DOCX/PDF, download bundle**. Các increment đã có được đối chiếu với [ADR 0004](adr/0004-submission-and-intake.md), [ADR 0005](adr/0005-submission-resolution.md), [ADR 0009](adr/0009-immutable-generated-documents.md), [ADR 0016](adr/0016-scoped-review-queue-counts.md). [ADR 0017](adr/0017-sprint6-document-rehearsal.md) được commit trước mã diễn tập riêng.

| Tiêu chí             | Kết quả kiểm chứng                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Tiếp nhận            | Nháp chưa vào queue; cán bộ nhận đúng phạm vi/quyền hiện tại; guest/sinh viên/cán bộ ngoài phạm vi bị từ chối                      |
| Hàng đợi             | Tổng năm trạng thái cùng visibility, tìm kiếm và phân công với trang; phân trang không làm tổng thành số hàng trang; UI user/admin |
| Quyết định           | Nhận xử lý, yêu cầu bổ sung, duyệt nội dung hoặc từ chối; xác nhận rõ; revision/idempotency; không tự cấp chữ ký                   |
| Bổ sung              | Sửa bản làm việc, gỡ/tải minh chứng mới rồi gửi lần hai; reviewer không nhìn bản chưa gửi; lịch sử và byte cũ giữ nguyên           |
| Thông báo và lịch sử | Thông báo trong ứng dụng, trạng thái đã đọc; sự kiện và hai snapshot đúng thứ tự                                                   |
| Word                 | Tự điền bốn thông tin sinh viên và sáu kiểu trường động từ bản chốt; giữ 0/Không và 15/Có; mẫu v1 nguyên hash                      |
| PDF                  | Chuyển từ đúng Word; kiểm tra ba cặp, cấu trúc/văn bản và trang hiển thị; lỗi converter không làm gửi lại hồ sơ                    |
| Tải riêng            | Owner/reviewer/admin đúng portal; ngoài quyền nhận 401/403/404; kiểm tra lại quyền sau I/O, no-store                               |
| Gói hồ sơ            | Word/PDF/minh chứng/manifest đúng round; tải lịch sử không lẫn minh chứng mới; gồm hồ sơ đã từ chối                                |
| CTSV và ký           | STUDENT_CONFIRMATION OFFLINE tại Phòng CTSV; mọi minh chứng NOT_CHECKED; APPROVED là duyệt nội dung                                |

## Thay đổi khi hoàn tất

Thêm lệnh một lần `npm run rehearse:sprint6 --workspace @student-service/api`. Profile riêng 127.0.0.11:3030/3031, UUID/state/cookie riêng; PostgreSQL tmpfs, API/Web build sao chép riêng và kho đĩa thật trong project/run. Checker cần parent IPC, từ chối cấu hình nguồn/production hoặc chạy trực tiếp. Kết thúc tự dừng process và xóa đúng container sở hữu. Không dùng lại lượt thực hành.

Mở rộng profile converter sealed của ADR 0015 sang rehearsal Sprint 6 theo ADR 0017: tài liệu giả, manifest/hash converter và file, profile độc lập mỗi tác vụ; deadline PDF 90 giây không tăng. Không kích hoạt signer.

Lượt đầu f8f5e299-f9a8-4497-9aad-b9c2fbf4814c khởi tạo profile hai lần (lần đầu timeout đã thu hồi, lần hai thành công), sau đó hết thời gian chờ máy chủ; chưa chạy browser, không dùng làm bằng chứng đóng. Chẩn đoán độc lập cùng seed thành công trong 84,455 giây, nhưng chưa kết luận nguyên nhân lượt khởi động lỗi. Thêm mốc thời gian startup/profile copy rồi chạy lượt mới với nguyên deadline; không tăng thời gian chuyển PDF 90 giây hoặc ngân sách chờ API cũ (600 lượt thăm dò, nghỉ 250ms; timeout 1 giây/yêu cầu). Log lỗi ban đầu sprint6-browser-rehearsal-20261014.log và diagnostic được giữ riêng; số đo local không phải cam kết hiệu năng.

Lượt cuối bootstrap một lần thành công; startup đạt READY sau 109,954 giây, profile 135 file/676697 byte. Ba lần render Word độc lập EXITED/empty=true trong 40,332/36,437/36,701 giây. Ba cặp ảnh Word/PDF khớp từng pixel ở 110dpi; 7 phần ảnh cắt chỉ dùng để đọc rõ màn hình mobile dài, ảnh gốc được giữ nguyên. Đây là bằng chứng riêng của lượt cuối.

Checker kiểm tra container sở hữu trước khi lấy credential ngẫu nhiên trong bộ nhớ; fake.env chỉ là marker trống, không chứa URL database. Giữ thông báo guard cũ cho mock-signature khi thêm profile mới, kiểm chứng tương thích bằng guard riêng.

Diễn tập bao gồm xuất Word/PDF/ZIP của hồ sơ **bị từ chối** ngoài hai lần gửi của hồ sơ đã duyệt. Đối chiếu registry/file thật bằng transaction chỉ đọc, ghép từng PDF với hash Word nguồn, job hoàn tất một attempt, không có retry hoặc ghi đè output. Mẫu Word v1 không sửa: `9074a0b961cf66b625d4339c4473a42c7bfc3d981816f821fa78552c7fae8ca2`.

## Kiểm thử và chất lượng

Mã cuối `971afe4b41d590b213e2c5b0c3b6a5436c51beff`; API/Web unit, integration và build chạy trên cùng mã sản phẩm, source API/Web không đổi giữa 099aff0 và mã cuối. Guard cuối và lượt browser mới dùng mã cuối; entry vault bổ sung log giai đoạn khởi tạo, không đổi deadline/chức năng.

| Bộ kiểm tra                     | Kết quả                 | Log trong project/run                         |
| ------------------------------- | ----------------------- | --------------------------------------------- |
| API unit toàn dự án             | 181 đạt, 1 skip Windows | sprint6-api-unit-20261014.log                 |
| API integration toàn dự án      | 307 đạt                 | sprint6-api-integration-verified-20261014.log |
| Web gồm Nuxt acceptance         | 124 đạt, 18 file        | sprint6-web-tests-20261014.log                |
| ADR gate tests                  | 44 đạt                  | sprint6-adr-tests-20261014.log                |
| Profile/CLI và tương thích mock | 28 đạt                  | sprint6-guards-completion-20261014.log        |
| API typecheck/lint, format      | Đạt                     | sprint6-{typecheck,lint,format}-20261014.log  |
| API/Web build                   | Đạt                     | sprint6-build-20261014.log                    |

Tổng **684 bài đạt, 0 lỗi, 1 skip**; không cộng lại Nuxt acceptance. Skip là test tạo file symlink vì Windows không cấp phép; không sửa code để né test. Lượt integration ban đầu chỉ migrate được rồi thiếu PATH của tsx, chưa chạy test; giữ log sprint6-api-integration-20261014.log, không dùng làm bằng chứng đạt. Helper được bổ sung PATH cục bộ, migration guard chỉ test 5434/student_service_test; container được dừng trong finally. Không nới guard migration của nguồn development.

## Diễn tập và kiểm tra hiển thị

Run `834c54f6-af76-480a-ad7a-5e147f9d659b`: **PASS 20 nhóm, 24 lượt responsive, 0 lỗi JavaScript**. Browser/API/PostgreSQL/kho đĩa thật, chỉ dữ liệu giả Nguyễn Minh An/GIA240001. Kiểm tra ở 375/768/1024/1440 px; 12 ảnh UI đã xem trực tiếp. Hồ sơ duyệt có hai lần gửi, hồ sơ từ chối có một lần gửi. Registry có 6 tệp/6 job COMPLETE, mỗi job 1 attempt, không retry; PDF source hash khớp Word tương ứng. Sáu ZIP được kiểm tra cấu trúc, hash và minh chứng đúng round.

Ba Word được render độc lập bằng công cụ render_docx dưới supervisor; ba PDF ứng dụng render bằng Poppler. 6 trang Word/PDF đã xem, dấu tiếng Việt và đủ 10 trường đúng; văn bản Word-rendered PDF trùng PDF ứng dụng, chữ nằm trong trang. Không dùng output timeout. Kiểm tra tự động bố cục và hash: `qa/pdf-layout-check.json`; kiểm tra trực quan: `qa/visual-review.json`.

Bằng chứng local ở `run/workflow-demo/834c54f6-af76-480a-ad7a-5e147f9d659b/`: browser-report.json, sprint6-document-inventory.json, Word/PDF ba cặp, ZIP, ảnh và qa. Report SHA-256 `9b52b55f62b77762ababaf5b427491886fff971cd94d11f9c697ecfc4e2f1dff`; inventory `de97c9e1fbdb2311928cb9ca3c5c6eeaa57f02b78bb25865874380cc889f7f18`. Log launcher: run/sprint6-browser-rehearsal-verified-20261014.log. Môi trường cuối **STOPPED**, container riêng đã được dọn; cổng 3031 không được báo là bản đang chạy.

## Cách lặp lại và giới hạn

Build API/Web với Node 22, Docker image postgres:17-alpine, Playwright/Chromium và LibreOffice đã chuẩn bị. Đặt LIBREOFFICE_PATH tuyệt đối tới soffice.com, WORKFLOW_PLAYWRIGHT_MODULE và WORKFLOW_CHROMIUM_EXECUTABLE theo máy. Chạy lệnh rehearsal phía trên; không truyền DATABASE_URL, SUBMISSION_STORAGE_ROOT hoặc APP_ENV=production. Sau đó kiểm tra inventory, render/xem trang và ảnh trước khi đóng lượt mới; report cũ không thay lượt mới.

**API chính vẫn render theo yêu cầu**. Kho registry/vault lưu byte bất biến được kiểm chứng ở runtime diễn tập riêng; chưa tự kích hoạt trên server chính hoặc nâng database legacy. Kích hoạt B2 trên nguồn, backup/restore khác thiết bị/B3, retention, quét mã độc, đo tải thực và nghiệm thu Học viện là backlog vận hành riêng. Sprint 7 sẽ làm workflow ký, verify và audit; spike mock trước đây chưa đóng Sprint 7. Hash không chứng minh hiệu lực chữ ký. Giấy xác nhận sinh viên tiếp tục làm trực tiếp CTSV.
