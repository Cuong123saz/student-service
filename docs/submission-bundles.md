# Gói tải theo từng lần gửi hồ sơ

## Cách dùng

Sau khi gửi hồ sơ điện tử, chọn **Tải trọn bộ hồ sơ** cạnh Tải Word/Tải PDF. Gói ZIP gồm:

- `phieu-ho-so.docx`: phiếu tự điền từ dữ liệu đã chốt của lần gửi được chọn.
- `phieu-ho-so.pdf`: chuyển đổi từ chính Word nằm trong gói đó.
- `minh-chung/`: nguyên byte các minh chứng của lần gửi, tên nội bộ gồm thứ tự và UUID để tránh trùng tên/đường dẫn. Tên gốc vẫn có trong manifest.
- `manifest.json`: danh sách tệp, dung lượng, SHA-256, số lần gửi, phiên bản thủ tục và mẫu Word.
- `HUONG-DAN.txt`: cách hiểu gói và giới hạn của kiểm tra toàn vẹn.

Sinh viên tải hồ sơ mình; cán bộ tải hồ sơ có quyền/phạm vi hiện tại từ cổng người dùng hoặc quản trị. Trong lịch sử, chọn đúng lần gửi rồi tải. Không gom các vòng bổ sung vào một gói; không lấy bản đang sửa hoặc quyết định xử lý vào phiếu kê khai. Hồ sơ nháp chưa gửi không có gói. Giấy xác nhận sinh viên OFFLINE vẫn hướng dẫn đến Phòng CTSV.

Gói là **bản kê khai chưa ký**, chưa phải văn bản được cấp. SHA-256 chỉ đối chiếu byte với danh sách trong manifest, không xác minh chữ ký số, người ký, nguồn phát hành hoặc hiệu lực pháp lý. Nếu cả tệp và manifest cùng bị thay, kiểm tra nội bộ gói không chứng minh được nguồn gốc. Không hiển thị mã băm thành dấu “chữ ký hợp lệ”.

## An toàn và giới hạn

Máy chủ lấy đúng snapshot của lần gửi, xác thực quyền trước khi đọc tệp và kiểm tra lại sau khi tạo gói. Mỗi minh chứng phải khớp metadata của round và vượt kiểm tra dung lượng/SHA-256 từ kho riêng. Thiếu, hỏng hoặc thay tệp trả `503 FILE_INTEGRITY`; không trả gói thiếu một phần hoặc giả vờ thành công. PDF không tạo được thì gói không được trả; vẫn có nút tải Word và tệp riêng, không yêu cầu sinh viên gửi lại.

Tối đa hai gói đang tạo trên một API instance, dùng chung giới hạn chuyển PDF tối đa hai tiến trình, mỗi tác vụ tối đa 90 giây. Quá số gói trả `503 BUNDLE_BUSY`, quá số converter trả `503 DOCUMENT_BUSY`. Route gói giới hạn sáu yêu cầu/phút. Minh chứng tối đa 20 MiB, từng tệp tối đa 5 MiB và tổng nội dung gói tối đa 40 MiB. ZIP dùng chế độ store vì Word/PDF/ảnh đã nén; tránh nén lại gây thêm CPU. Chưa phải hàng đợi nền, dịch vụ nhiều instance hoặc cam kết chịu tải production.

Tải gói trả `attachment`, `application/zip`, `private, no-store`, `nosniff`. Không URL công khai, không ghi byte riêng tư, câu trả lời hoặc storage key vào log/manifest. Tạo gói không sửa hồ sơ, không ghi quyết định và không tạo audit giả cho một thay đổi nghiệp vụ không xảy ra.

Mẫu `submission-summary-v1.docx` được khóa SHA-256 trong renderer. Thiếu/sửa mẫu trả `503 DOCUMENT_TEMPLATE_UNAVAILABLE` thay vì tạo phiếu âm thầm khác cho hồ sơ cũ. Word/PDF dùng chung một lần đọc mẫu khi tạo gói. Migration0022 đã gắn id/hash/nguồn mẫu vào từng round theo ADR0009; renderer dùng binding đó. Chưa có mẫu v2; khi bổ sung phải giữ v1 và kiểm chứng khả năng đọc lại. Không đổi hằng hash để ghi đè bố cục v1.

Tài liệu và ZIP được tạo theo yêu cầu, chưa lưu lâu dài trong kho. Word cùng snapshot/v1 giữ nguyên byte; PDF và ZIP có metadata thời điểm tạo nên không cam kết cùng byte ở hai lần tải. Muốn đối chiếu chính gói đã tải, lưu mã băm của gói ở nơi tin cậy riêng. Mã băm tải mới không thay mã của bản đã ký trong tương lai.

## API

GET, session đúng cổng, không nhận đường dẫn kho hoặc tên tệp do client chỉ định:

- `/api/v1/user/submissions/:id/rounds/:roundNumber/bundle`
- `/api/v1/user/review-submissions/:id/rounds/:roundNumber/bundle`
- `/api/v1/admin/review-submissions/:id/rounds/:roundNumber/bundle`

Số lần gửi là integer 1..2147483647; không tồn tại trả 404; UUID/số không hợp lệ trả 400. Session thiếu/sai cổng trả 401; bị thu quyền trả 403 hoặc 404 theo chính sách hồ sơ. Tên tải `goi-ho-so-<uuid>-lan-<n>.zip`.

Manifest schema `student-service.submission-bundle`, version 1. Gói từ migration0022 kèm template.bindingSource SUBMITTED hoặc LEGACY_V1; verifier vẫn nhận gói version1 cũ thiếu trường đó. Đây là nguồn gắn mẫu, không phải nguồn chứng thực/hiệu lực chữ ký. Mọi tệp trừ chính manifest đều có path, kind, MIME, size và SHA-256. Minh chứng thêm fileId, attachmentKey, originalName và NOT_CHECKED. Không có giá trị VALID hoặc con dấu được tạo bởi bước này.

## Kiểm tra gói trên máy

Từ thư mục gốc dự án, Node 22:

```powershell
npm run bundle:verify --workspace @student-service/api -- D:/du-lieu/goi-ho-so.zip
```

Nếu đã lưu riêng mã SHA-256 đáng tin cậy của chính ZIP:

```powershell
npm run bundle:verify --workspace @student-service/api -- D:/du-lieu/goi-ho-so.zip --sha256 <64-ky-tu-hex-chu-thuong>
```

Kết quả `CHECKSUMS_MATCH_UNSIGNED` chỉ có nghĩa mã kiểm tra khớp. Công cụ đọc có giới hạn, không giải nén xuống đĩa, không sửa tệp, không gọi mạng. Chỉ nhận ZIP chế độ store do máy chủ xuất; không giải nén dữ liệu DEFLATE không tin cậy. Không nén lại gói trước khi kiểm tra. Từ chối path lạ/traversal, tên ZIP trùng, tệp thiếu/thừa, size/hash sai, manifest sai hoặc gói quá lớn; đối chiếu kích thước nén/gốc và tổng giới hạn trước khi đọc nội dung từng entry. Không in câu trả lời/nội dung minh chứng ra màn hình.

## Bản thử riêng

Bản thử gói dùng `http://127.0.0.3:3015/login`, API `127.0.0.3:3014`, database/tmpfs/kho giả và cookie riêng; giữ nguyên các bản 3011/3013. Mỗi lượt dùng runtime bản dựng riêng.

```powershell
npm run build
$env:LIBREOFFICE_PATH = 'D:/student-service/run/tools/LibreOffice/program/soffice.com'
npm run demo:bundles --workspace @student-service/api
```

Sau `WORKFLOW_DEMO_READY`, đăng nhập `demo.sinhvien` hoặc `demo.canbo`, mật khẩu `DemoSinhVien#2026!`. DEMO 1/2 dành cho kiểm thử; DEMO 3 để tự thực hành. Checker trên lượt mới:

```powershell
npm run demo:bundles:check --workspace @student-service/api
```

Dừng chỉ bản này bằng `npm run demo:bundles --workspace @student-service/api -- stop`; dữ liệu tmpfs mất khi dừng. Không dùng cho hồ sơ thật.

## Bằng chứng kiểm chứng

Ngày 11/10/2026, build API/Web, typecheck, lint, format đạt; không đổi schema hoặc dữ liệu thật. API đạt 121 unit, 263 integration, 22 storage, 20 fixture, 126 recovery và 6 rào chắn demo. Công cụ ZIP đạt 6 kiểm thử sau khi siết chế độ store và kích thước khai báo. Web đạt 116 kiểm thử. Từng nhóm là tập riêng, không cộng lại các lượt chạy lặp.

Chromium trên lượt `bc5b0a00-e314-4416-a67b-eb88659779ae` đạt trọn luồng: gửi, bổ sung, duyệt/từ chối; tải Word/PDF/gói ở sinh viên, cán bộ và quản trị; đối chiếu toàn bộ byte Word và minh chứng lịch sử; chặn khác chủ/ngoài phạm vi; giữ CTSV OFFLINE và DEMO 3 chưa dùng. 20 kiểm tra độ rộng 375/768/1024/1440 đạt, không lỗi JavaScript. Đã xem ảnh riêng vùng tải ở 375/1440 và ảnh từng trang Word/PDF thực lấy từ gói, không cắt nội dung.

Đo cục bộ ba yêu cầu gói đồng thời: hai gói thành công khoảng 21,2 giây; yêu cầu vượt mức trả BUNDLE_BUSY sau 50 ms. 21 lần gọi API danh mục trong lúc tạo gói đều 200, thời gian lớn nhất 37 ms. Sau giải phóng, tải tiếp thành công khoảng 18,7 giây. Đây là một phép đo bằng gói giả khoảng 235 kB trên một máy; không suy ra năng lực cho hồ sơ 20 MiB, nhiều API instance hoặc hàng trăm người dùng.

Kiểm tra cấu hình thật trả READY: Word khoảng 90 ms, PDF khoảng 19,8 giây. Hai lượt trình duyệt trước gặp giới hạn 45 giây; giữ bằng chứng lỗi và sửa giới hạn lên 90 giây trước lượt đạt, không bỏ qua PDF lỗi hoặc tự gán hoàn tất. Hai bản thực hành 3011/3013 được giữ nguyên; các lượt demo gói bị dừng chỉ có hồ sơ do checker tạo, đã đối chiếu trước khi dừng.

Bằng chứng được Git bỏ qua: `run/bundle-api-final.log`, `run/bundle-web-tests.log`, `run/bundle-verifier-final.log`, `run/bundle-runtime-real.log`, `run/bundle-browser-final.log`, `run/bundle-capacity.log`; browser-report/capacity-report và ảnh nằm trong thư mục lượt demo. Gói ví dụ `run/output/archives/goi-ho-so-mau.zip` chứa dữ liệu giả. Không tự đóng Sprint 4 hoặc nghiệm thu vận hành dữ liệu thật bằng các kiểm thử này.

## Kiểm chứng bổ sung ở giới hạn 20 MiB

Sau mốc trên, đã kiểm tra qua HTTP multipart thật của Fastify: bốn PDF hợp lệ, mỗi tệp đúng 5 MiB; gửi hồ sơ rồi tải gói có converter LibreOffice thật. Gói 21.199.040 byte trả 200 trong 18.160 ms trên một lượt chạy. Tệp lớn hơn 5 MiB một byte trả 413 và không lưu vào kho; tệp bổ sung làm tổng vượt 20 MiB trả 422 ATTACHMENT_LIMIT, không đổi revision hoặc số tệp đã lưu. Không phát hiện lỗi ranh giới multipart nên không sửa giới hạn sản phẩm.

Đối chiếu độc lập bằng pypdf strict=True: PDF kê khai và cả bốn minh chứng đều có một trang, đọc được nội dung. Minh chứng tăng dung lượng bằng comment PDF trước startxref, giữ nguyên offset và cấu trúc gốc; không đổi MIME của một khối byte tùy ý thành PDF. Công cụ bundle:verify xác nhận bảy tệp được kê trong manifest đều khớp size/SHA-256. Sửa một byte của minh chứng trong kho làm tải gói trả 503 FILE_INTEGRITY trước khi gọi lại converter. Đã xem ảnh trang Word/PDF xuất từ chính lượt này, không cắt nội dung.

Kiểm thử mới dùng converter giả trong CI để không phụ thuộc LibreOffice. Profile thật yêu cầu CAPACITY_REAL_CONVERTER=true cùng LIBREOFFICE_PATH được chỉ định. Toàn bộ file submission.repository.test.ts đạt 94/94 sau bổ sung. Đây là kiểm chứng một hồ sơ đủ dung lượng, chưa đo hai hồ sơ 20 MiB đồng thời, bộ nhớ cực đại hoặc tải kéo dài; không thay phép thử production.

Bằng chứng local bị Git bỏ qua: run/bundle-capacity-20m-http-before.log, run/bundle-capacity-20m-http-real.log, run/bundle-capacity-20m-validation.log, run/bundle-capacity-20m-cli.log, run/bundle-capacity-integration-final.log và run/document-qa/capacity-20m. Gói fake run/capacity-full-20m.zip có SHA-256 85ff07d16eee835e2c5a697bd99479dd7c84b1a15d30385cc7a446c5a17637fe. Không chứa dữ liệu thật hoặc chữ ký số.
