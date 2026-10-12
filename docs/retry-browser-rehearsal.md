# Diễn tập mở thêm lượt PDF trên trình duyệt

Bài chạy một lần dùng API, PostgreSQL và LibreOffice thật, dữ liệu giả; không thay phản hồi HTTP bằng mock. Lệnh tại workspace API: `npm run rehearse:retry-browser`. Cần build API/web trước, Node22, Docker có image postgres:17-alpine, Windows và đường dẫn tuyệt đối `LIBREOFFICE_PATH` đến soffice.com. Playwright/Chromium có thể chỉ định qua `WORKFLOW_PLAYWRIGHT_MODULE` / `WORKFLOW_CHROMIUM_EXECUTABLE`.

## Ranh giới

Profile retry dùng riêng 127.0.0.5:3019/API3018, active state riêng và UUID mới cho từng lần. Không nối database development/test hoặc thư mục của demo đang thực hành. Chỉ profile này cấp quyền document.retry cho role DRILL_REVIEW trong database giả; không cấp mặc định cho ADMIN.

Entry API được chép vào snapshot riêng, kiểm tra IPC, UUID, APP_ENV=test, đường dẫn, database ngẫu nhiên và origin cố định trước khi import ứng dụng. Điều khiển lỗi chỉ qua IPC giữa những process của bài chạy; không có endpoint HTTP bật/tắt lỗi. Profile vault thường không nhận các lệnh này. Trước khi mở browser, readiness vẫn dùng bộ chuyển thật.

Lệnh ARM chỉ chấp nhận đúng một hồ sơ/một round, một Word đã lưu thành công, chưa có PDF hoặc retry, SHA Word khớp. Ba request PDF thật đi qua coordinator, provenance, lease và registry như bình thường, rồi bộ chuyển giả lỗi cho đúng SHA đó. Không sửa trực tiếp bộ đếm hoặc trạng thái job bằng SQL. REPAIR chỉ chấp nhận sau đúng ba lỗi CONVERT_FAILED; chưa mở lượt, không xóa attempts. Lượt mới phải được cấp qua nút UI/API thật có quyền, phạm vi và audit.

## Các điểm kiểm chứng

- Gửi hồ sơ với số0 và boolean false vẫn đúng type; xuất Word đã lưu.
- PDF lỗi ba lần: trạng thái EXHAUSTED, Word vẫn giữ nguyên byte, sinh viên không có nút hoặc quyền mở lượt.
- Cán bộ ngoài phạm vi bị từ chối cả status và retry; cán bộ nhận hồ sơ đúng phạm vi được thao tác.
- Checkbox khắc phục mặc định bỏ chọn, nút bị khóa; màn hình375/1440 không tràn ngang.
- Sau khắc phục, mở đúng một lượt: attempts vẫn3, allowance1, một quyết định và một audit cùng actor.
- Các lần bị từ chối và mở lượt chia sẻ giới hạn IP: request thứ4 nhận429. Chờ đúng Retry-After rồi gửi lại cùng request, kết quả đã áp dụng, không cấp thêm lượt.
- PDF thật thành công lần4, trạng thái READY, sourceDocxSha256 và renderer khớp Word cũ; Word tải lại không đổi, tài liệu ghi UNSIGNED_DECLARATION.

## Bằng chứng và giới hạn

Mỗi run giữ browser-report.json, ảnh màn hình, Word trước/sau, PDF, log API tách VERSION/PDF và retry-diagnostic.sql trong run/workflow-demo/UUID. SQL là snapshot chẩn đoán dữ liệu giả, **không phải backup phục hồi đã kiểm chứng**. Kho Word/PDF/staging ngoài thư mục project được giữ. Sau bài chạy, chỉ process/container sở hữu bởi UUID này được dừng; demo vault của người dùng vẫn hoạt động.

Lỗi được chủ động đưa vào để kiểm chứng retry; bài này không chứng minh nguyên nhân lỗi PDF đầu trước đây đã được khắc phục, không thay thử tải/TCP/UAT và không xác minh chữ ký số hoặc phát hành chính thức.

## Kết quả ngày12/10/2026

Run `81e154a8-d846-47f7-9648-6c18dba40145` PASS cả7 nhóm kiểm chứng, không lỗi JavaScript;375/1440px không tràn ngang. Word sau ba lỗi và sau PDF thành công giữ nguyên byte; hai file trong documents và hai file staging khớp đúng SHA tải về. PDF thực một trang đã xem, đúng tiếng Việt, số0 và Không, sourceDocxSha256 khớp; job PDF COMPLETE/attempts4/allowance1, Word COMPLETE/attempts1/allowance0, một retry và một audit USER cùng actor. SQL chẩn đoán132491 byte, SHA256 `1b00c7eff8cba0f66df5fd94c17c95f12f7b45a01618e9479ff5c97a32e51def`; trạng thái run STOPPED và đúng container này đã dọn, demo vault12d8 vẫn chạy.

12 bài guard profile/IPC/nguồn dữ liệu/marker/child-exit đạt; API build, typecheck, lint và kiểm tra cú pháp script đạt. Không chạy lại306 integration của migration/route vì không đổi schema hoặc route sản phẩm trong mốc này.

Lượt đầu `e26bfec0-dc8b-4c87-b12b-14a57667293a` đạt5 nhóm trước khi bổ sung kiểm tra gửi lặp. Lượt `e062b16e-096d-45e7-aa0f-3176b416a68e` dừng vì bài kiểm tra kỳ vọng200 ngay khi request thứ4 thực tế bị giới hạn429; đã giữ report/kho/SQL, sửa bài kiểm tra chờ Retry-After. Không nới giới hạn API, không đổi lượt thất bại thành đạt.
