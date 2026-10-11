# Phiếu thông tin hồ sơ Word và PDF

## Cách dùng

Sinh viên kê khai, lưu, xem lại, xác nhận và gửi hồ sơ ONLINE/HYBRID. Sau khi máy chủ ghi nhận thành công, phần **Phiếu thông tin hồ sơ** có hai nút **Tải Word** và **Tải PDF**. Không cần nhập lại thông tin vào Word. Cán bộ có quyền xem hồ sơ trong phạm vi được giao cũng tải được phiếu ở trang tiếp nhận của cổng người dùng hoặc quản trị.

Phiếu dùng chung cho mọi thủ tục đã có hồ sơ điện tử: tên thủ tục, mã hồ sơ, lần gửi, thời điểm gửi theo giờ Việt Nam, phiên bản biểu mẫu, đơn vị xử lý, thông tin sinh viên và toàn bộ trường được cấu hình. Sáu kiểu TEXT/TEXTAREA/NUMBER/DATE/SELECT/BOOLEAN được chuyển thành nội dung dễ đọc; số `0`, lựa chọn `Không`, nhãn lựa chọn và xuống dòng được giữ đúng. Phiếu liệt kê tên, loại và dung lượng minh chứng của chính lần gửi đó; tệp gốc tải riêng trong hồ sơ.

Khi bổ sung rồi gửi lại, phiếu lần hai lấy snapshot lần hai. Mở **Lịch sử hồ sơ**, mở lần gửi cần xem và tải phiếu của lần đó. Thay đổi nội dung đang bổ sung hoặc hồ sơ cá nhân không viết lại lần gửi cũ. Bản nháp chưa gửi chưa có phiếu; mục chưa kê khai được ghi rõ, không tự bịa dữ liệu.

Phiếu là **bản kê khai chưa ký**, không phải kết quả đã được cấp. Phê duyệt nội dung không làm phát sinh chữ ký số hoặc con dấu. Minh chứng vẫn có trạng thái chữ ký chưa xác minh. Giấy xác nhận sinh viên đang OFFLINE tiếp tục hướng dẫn làm việc tại Phòng CTSV.

## Vận hành

Word được điền từ template `apps/api/templates/submission-summary-v1.docx`, không gọi mô hình AI. PDF được chuyển từ đúng Word đã điền bằng LibreOffice chạy headless. Tệp được tạo khi chọn tải, ngoài transaction gửi hồ sơ: lỗi tạo PDF không làm mất hồ sơ hoặc yêu cầu sinh viên gửi lại. Word vẫn tải được nếu bộ chuyển PDF chưa sẵn sàng.

Cài LibreOffice trên máy chạy API và cấu hình biến `LIBREOFFICE_PATH` bằng đường dẫn tuyệt đối đến executable. Windows dùng `soffice.com` để chờ đúng tiến trình; Linux dùng `soffice`. Nếu bỏ trống, máy chủ tìm tên tương ứng trong PATH. Cần thư mục tạm ghi được và font hỗ trợ tiếng Việt; máy triển khai phải kiểm tra lại bố cục sau khi thay font.

Máy local hiện dùng bản LibreOffice 26.8.1 được giải nén riêng tại `D:/student-service/run/tools/LibreOffice/program/soffice.com`; không cài đè ứng dụng hệ thống. MSI từ The Document Foundation, chữ ký Authenticode Valid, SHA-256 `c6298b10cfa1748bcbedad94c62ce771e240e5021bfd6d7a967cd571b04b5312` được đối chiếu trước khi giải nén. Binaries trong `run/` được Git bỏ qua, cần chuẩn bị lại trên máy khác.

Khi triển khai, giữ `apps/api/templates/` cạnh `apps/api/dist/`; bản dựng TypeScript không tự đóng gói tài nguyên. Chỉ dùng template quản lý trong mã nguồn, không nhận DOCX tuỳ ý từ người dùng để chuyển đổi.

Mỗi API instance cho chạy tối đa hai tác vụ chuyển PDF cùng lúc, tác vụ tối đa 90 giây trước khi dừng tiến trình do nó tạo. Quá tải trả `503 DOCUMENT_BUSY`; lỗi/thiếu converter trả `503 DOCUMENT_PDF_UNAVAILABLE` với hướng dẫn tải Word hoặc thử lại. Route giới hạn 12 yêu cầu/phút. Đây là giới hạn bảo vệ ban đầu cho local; cần đo tải trước khi xác định năng lực vận hành thực tế. Mỗi tác vụ có thư mục/profile LibreOffice riêng và được dọn sau khi xử lý; không ghi nội dung riêng tư vào log chuyển đổi.

Tài liệu được trả với `Content-Disposition: attachment`, `Cache-Control: private, no-store` và `X-Content-Type-Options: nosniff`. Kiểm tra chủ sở hữu hoặc quyền/phạm vi cán bộ cả trước và sau khi chuyển đổi. Mất quyền trong lúc chờ không nhận được tệp. Không có đường dẫn tải công khai.

Tham khảo chính thức: [tham số dòng lệnh LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html), [xuất PDF](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html).

## API

Các route GET yêu cầu session đúng cổng:

- `/api/v1/user/submissions/:id/rounds/:roundNumber/documents/:format`: sinh viên sở hữu hồ sơ.
- `/api/v1/user/review-submissions/:id/rounds/:roundNumber/documents/:format`: cán bộ đúng quyền/phạm vi.
- `/api/v1/admin/review-submissions/:id/rounds/:roundNumber/documents/:format`: cán bộ đăng nhập cổng quản trị, vẫn kiểm tra quyền/phạm vi.

`format` chỉ nhận `docx` hoặc `pdf`. Không có lần gửi trả 404; định dạng hoặc số lần gửi không hợp lệ trả 400. Tên tải `phieu-ho-so-<id>-lan-<round>.<format>`. Chưa lưu tài liệu đã sinh hoặc chữ ký/hash tài liệu vào database; tải lại Word của cùng lần gửi dưới template v1 cho cùng nội dung. Mẫu v1 hiện được khóa mã băm trong renderer; không ghi đè mẫu/hằng hash để thay bố cục. Nếu thêm v2 phải quản lý phiên bản gắn với round trước khi áp dụng cho hồ sơ đã lưu. Có thể [tải trọn một lần gửi thành gói ZIP](submission-bundles.md), gồm Word/PDF/minh chứng và manifest kiểm tra tệp.

## Bản thử riêng cho xuất phiếu

Giữ được môi trường thực hành trước đó ở `127.0.0.1:3011`. Bản thử xuất phiếu dùng `http://127.0.0.2:3013/login`, API `127.0.0.2:3012`, database và kho minh chứng giả riêng. Cookie tách theo địa chỉ máy; mở đúng `127.0.0.2`. Mỗi lượt mới chép bản dựng API/Web và template vào thư mục runtime riêng trong runRoot, để build tiếp ở mã nguồn không làm mất tệp của demo đang chạy.

Chạy từ thư mục gốc, Node 22, Docker và image `postgres:17-alpine` đã sẵn, không nạp DATABASE_URL/SUBMISSION_STORAGE_ROOT từ môi trường khác:

```powershell
npm run build
$env:LIBREOFFICE_PATH = 'D:/student-service/run/tools/LibreOffice/program/soffice.com'
npm run demo:documents --workspace @student-service/api
```

Chờ `WORKFLOW_DEMO_READY`. Tài khoản `demo.sinhvien` và `demo.canbo`, mật khẩu demo chung `DemoSinhVien#2026!`. Trong Dịch vụ chọn **DEMO 3 - Bạn tự thực hành**, kê khai đủ, tải minh chứng PDF giả rồi gửi. Hai thủ tục DEMO 1/2 dành cho bài kiểm thử. Tệp mẫu nằm trong `apps/api/scripts/fixtures/recovery/`.

Trên lượt mới, có Playwright/Chromium, chạy:

```powershell
npm run demo:documents:check --workspace @student-service/api
```

Bài kiểm thử dùng trình duyệt riêng để gửi, tải Word/PDF ngay sau gửi, bổ sung, tải lần hai và đối chiếu Word lịch sử lần đầu khớp toàn bộ byte; kiểm tra tải từ cán bộ và quản trị, chặn ngoài phạm vi, cùng luồng duyệt/từ chối và giao diện ở bốn độ rộng. `run/workflow-document-demo-active.json` trỏ đến lượt này; `browser-report.json`, ảnh giao diện và tài liệu tải nằm trong thư mục lượt demo được Git bỏ qua.

Dừng chỉ bản thử xuất phiếu:

```powershell
npm run demo:documents --workspace @student-service/api -- stop
```

Dữ liệu giả ở bộ nhớ tạm mất khi dừng; không dùng môi trường này lưu hồ sơ thật. Môi trường demo quy trình cũ có lệnh start/stop và active file riêng.

## Kiểm chứng local ngày 11/10/2026

Build API/Web, typecheck, lint, format và cổng ADR đạt; không thay schema/database. Hồi quy API đạt 109 unit, 262 integration, 22 storage, 20 fixture, 126 recovery và 5 rào chắn demo ở lượt đầy đủ; sau khi bổ sung danh sách minh chứng đã chạy lại toàn bộ 11 kiểm thử xuất phiếu và hai integration liên quan. Web đạt 112 kiểm thử, cùng lượt acceptance riêng 91 kiểm thử.

Chromium chạy trọn luồng bằng dữ liệu giả: đủ sáu kiểu trường, gửi, tải Word/PDF ngay sau gửi, bổ sung rồi tải lần hai, đối chiếu toàn bộ byte của Word lịch sử, tải từ cán bộ và quản trị, chặn người khác/ngoài phạm vi, duyệt/từ chối, giữ hướng dẫn CTSV và 20 kiểm tra độ rộng. Không có lỗi JavaScript trang. Sau chỉnh template, lượt tải lại qua ba vai trò cũng đạt.

Word mẫu và PDF tải thật đã được dựng thành ảnh và xem trực quan; bản thông thường một trang. Phiếu 50 trường dùng chính renderer của ứng dụng, có hai nội dung 2000 ký tự (một không có khoảng trắng), giữ đủ trường cuối và ký tự khi sang nhiều trang. Đây là kiểm chứng local, chưa phải đo tải đồng thời hoặc nghiệm thu vận hành dữ liệu thật.

Đã kiểm tra lại việc tách runtime trên lượt mới: luồng trình duyệt Word/PDF đạt. Môi trường thực hành cũ được sao lưu và phục hồi sang lượt mới tại cùng địa chỉ 3011 sau khi bản dựng làm mất tài nguyên cũ; hồ sơ đã duyệt và minh chứng từng lần gửi được giữ nguyên, không yêu cầu sinh viên kê khai lại. Các lượt khởi động từ mã mới sử dụng runtime riêng để tránh lặp lại vấn đề này.

## Kiểm tra máy chạy API

Sau build API, chạy `npm run documents:check --workspace @student-service/api`. Công cụ dùng dữ liệu giả đủ sáu kiểu trường, kiểm tra mẫu v1, Word và chuyển PDF thật; không truy cập database/hồ sơ hoặc ghi tài liệu kiểm tra lâu dài. Báo `READY`, `WORD_ONLY` hoặc `UNAVAILABLE`, kèm thời gian và mã lỗi an toàn. Word-only/unavailable trả exit code 1 để triển khai phát hiện cấu hình chưa đủ. Báo READY không thay việc xem bố cục/font và đo tải.

Kiểm thử gói ngày 11/10 ghi nhận một số lượt chuyển PDF bằng LibreOffice vượt 45 giây trên máy local; đã tăng giới hạn chờ hữu hạn lên 90 giây, vẫn giữ tối đa hai tác vụ và dừng đúng cây tiến trình do tác vụ tạo. Không tăng số tiến trình để bù cho máy chậm, không bỏ giới hạn chờ. Khi thiếu tài nguyên hoặc bộ chuyển bị treo, có thể nhận lỗi và tải Word/thử PDF lại; hồ sơ không bị mất.


## Gắn phiên bản mẫu cho từng lần gửi

Theo ADR0009 và migration0022, mỗi round có declarationTemplate gồm id, sha256 và bindingSource. Ghi SUBMITTED cùng transaction gửi; client không chọn mẫu. Round cũ được gắn v1 với LEGACY_V1 để tương thích, không khẳng định đã lưu PDF hoặc chứng minh mẫu từng được tải trước đây. Trigger lịch sử cấm sửa cả binding. Renderer đọc đúng catalog/binding; thiếu hoặc không khớp trả DOCUMENT_TEMPLATE_UNAVAILABLE, không chuyển sang mẫu mới tự động. Mẫu v1 và byte Word giữ nguyên.

Đây mới là gắn phiên bản mẫu. File đầu ra vẫn tạo theo yêu cầu; chưa lưu lâu dài byte Word/PDF, chưa có lease/job hoặc registry phát hành. Trước phần đó phải bổ sung thiết kế registry, kho output và kiểm chứng backup/restore theo ADR0009. Không gán hiệu lực chữ ký từ metadata này.


Kiểm chứng phần gắn mẫu ngày 11/10/2026: API đạt 124 unit, 264 integration, 22 storage, 20 fixture, 126 recovery, 6 rào chắn demo và 7 verifier; 37 kiểm thử rào chắn ADR và 5 rào chắn profiler đạt. Build/typecheck/lint API và lint script đạt; Drizzle generate báo không còn lệch schema/snapshot. Không đổi giao diện, layout hoặc file template v1.

Chromium fake trên lượt 203b1d95-9374-4684-96b8-b67a1c98d5e4 đạt luồng ba cổng, tải năm gói đúng binding, giữ Word/minh chứng lần gửi cũ, 20 kiểm tra kích thước màn hình và không lỗi JavaScript. DEMO 3 chưa dùng. Lượt demo gói trước chỉ có ca checker, đã đối chiếu hai lần và sao lưu SQL trước khi dừng; runtime 3011/3013 và dữ liệu thực hành giữ nguyên.

Phục hồi fake cuối cùng 7a99d654-5e06-4791-9dd7-0bf4e4eb8479 đạt: snapshot 26 bảng và bốn sequence khớp, nguyên byte minh chứng, binding hai round còn nguyên; container riêng được dọn bởi chính rehearsal. Development đã áp dụng0022 trong transaction với khóa ngắn, sau SQL backup; đối chiếu đủ26 bảng trước/sau không đổi nội dung cũ. Development lúc nâng cấp có0 round, nên bằng chứng backfill round cũ là migration test riêng, không tuyên bố đã backfill dữ liệu thực tế. SQL backup development chưa phải bản sao phục hồi đầy đủ kho tệp.

Log local bị Git bỏ qua: run/document-binding-api-final.log, run/document-binding-adr-final.log, run/document-binding-browser.log, run/document-binding-recovery-final.log, run/document-binding-dev-migration.log, run/document-binding-typecheck.log, run/document-binding-lint.log, run/document-binding-build.log và run/document-binding-scripts-lint.log. Chưa đóng Sprint4 hoặc bật ký/phát hành.
