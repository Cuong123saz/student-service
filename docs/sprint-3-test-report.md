# Biên bản kiểm thử Sprint 3

## Phạm vi và kết luận hiện tại

Biên bản này ghi lại baseline kỹ thuật được tái kiểm chứng ngày 13/09/2026 cho commit `ffa38f5`, cùng demo trực tiếp trên `ba80759` (có chứa `ffa38f5`) và kiểm tra hồi quy trên `777c3f9`. P0.1–P0.5 của luồng import đạt ở cấp triển khai và kiểm thử local; Import API chưa production-ready/deployed. Demo đã hoàn tất, nhưng biên bản này không thay thế chữ ký của người có thẩm quyền.

S3-12 được kiểm chứng bằng hai lớp bổ trợ nhau: integration test gọi API thật với database test và acceptance test gắn các trang Nuxt trong DOM rồi thao tác như người dùng. Cách này kiểm tra đủ upload → preview → confirm, lọc → xem metadata → phân trang và trạng thái thiếu quyền mà không thay đổi mật khẩu `system.admin`. Demo trực tiếp trên trình duyệt bằng tài khoản local thuộc bước nghiệm thu S3-13; bộ test hiện tại không được mô tả là Playwright full-stack.

## Môi trường kiểm thử

- Ngày tái kiểm chứng: 13/09/2026.
- Nhánh: `main`.
- Commit chức năng được tách và kiểm chứng: `ffa38f5c9dc57c27c3883d7684d894e6d73b4df0` (`feat: harden student imports for production`).
- API: Node.js, Fastify và PostgreSQL 17.
- Web: Nuxt 4.5.2, Vue 3.5.41 và Vite 8.2.2.
- PostgreSQL test: container `student-service-postgres-test`, database dùng `tmpfs`.
- Development local: API `http://localhost:3000`, Web `http://localhost:3001`, Mailpit `http://localhost:8025`.

## Kết quả tự động

| Hạng mục | Kết quả | Bằng chứng |
| --- | --- | --- |
| API typecheck | Đạt | `npm run typecheck --workspace @student-service/api` |
| API unit test | 80 đạt, 0 lỗi | `npm run test:unit --workspace @student-service/api` |
| API integration test | 153 đạt, 0 lỗi | `npm run test:integration --workspace @student-service/api` |
| API production build | Đạt | `npm run build --workspace @student-service/api` |
| Web unit test | 26 đạt, 0 lỗi | `npm run test --workspace @student-service/web` |
| Web acceptance test | 5 đạt, 0 lỗi | `npm run test:acceptance --workspace @student-service/web` |
| Web production build | Đạt | `npm run build --workspace @student-service/web` |

Integration test đã bao phủ các bằng chứng quan trọng sau:

- Import CSV và XLSX, preview, confirm và ghi audit.
- Rollback toàn bộ khi dữ liệu bị trùng sau thời điểm preview.
- Các chiến lược `FAIL`, `SKIP` và `OVERWRITE`.
- Preview không tồn tại, validation error và thiếu quyền `student.import`.
- Export theo permission, bộ lọc và data scope.
- Audit log yêu cầu `audit.read`, trả `401` khi chưa đăng nhập và `403` khi thiếu quyền.
- Invitation queue, claim job, retry và trạng thái gửi thành công.
- Data scope `GLOBAL`, `FACULTY`, `CLASS` và `ORGANIZATION`.
- Sửa tên, mã sinh viên, khoa/lớp theo `student.update`, ghi audit và từ chối mã không phải số.
- File Excel mẫu tải từ màn danh sách có đúng bốn cột import và được parser đọc lại thành công.
- Hai request confirm đồng thời trên cùng `previewId` chỉ commit một lần trên PostgreSQL thật.
- Preview lock hết hạn được lazy-reclaim; holder cũ không thể giải phóng lease mới.
- Preview hết hạn được dọn mà không làm worker lỗi ràng buộc; job đã thành công vẫn giữ lịch sử và API trả lỗi hết hạn có chủ đích khi preview không còn.
- Worker từ chối XLSX có tỷ lệ nén bất thường trước bước giải nén và parse XML.
- CSV dùng parser battle-tested, bao phủ quote lồng, nhiều dòng, mixed line ending và trường trống cuối dòng.

## Hardening P0 của luồng import

| Mã | Bằng chứng tại `ffa38f5` | Trạng thái local |
| --- | --- | --- |
| P0.1 | Commit import dùng transaction và unique constraint; race confirm được kiểm thử trên PostgreSQL. | Đạt |
| P0.2 | API lưu file/trả `jobId`; worker process riêng parse CSV/XLSX; frontend poll trạng thái. | Đạt |
| P0.3 | Upload bị chặn ở 5 MB, có giới hạn hai lượt đọc đồng thời; file `bytea` có TTL. Request vẫn kết khối dữ liệu đã giới hạn trước khi ghi PostgreSQL, nên capacity production phải được kiểm định riêng. | Đạt local |
| P0.4 | Preflight ZIP giới hạn số entry, tổng byte giải nén, compression ratio, ZIP64, multi-disk và archive mã hóa. | Đạt |
| P0.5 | File, job và preview dùng PostgreSQL; confirm có atomic acquire, lease 5 phút, lazy reclaim và consume cùng transaction import. | Đạt local |

File gốc được lưu ở bảng riêng trong PostgreSQL thay vì S3/MinIO. Dữ liệu file và preview hết hạn được dọn lười khi enqueue hoặc worker claim công việc mới. `InMemoryStudentImportPreviewStore` chỉ còn là implementation phục vụ unit test/local injection, không phải mặc định của API. Kết quả này xác nhận kiến trúc ở local, không xác nhận capacity, backup/restore, monitoring hoặc vận hành worker trên production.

## Kiểm tra giao diện và acceptance

| Kịch bản | Trạng thái | Kết quả |
| --- | --- | --- |
| Mở `/admin/students/import` khi chưa đăng nhập | Đạt | Chuyển về `/admin/login` |
| Mở `/admin/audit-logs` khi chưa đăng nhập | Đạt | Chuyển về `/admin/login` |
| Lỗi console tại trang đăng nhập | Đạt | Không có lỗi hoặc cảnh báo |
| Chọn file, preview và confirm import trên trang Nuxt | Đạt | Acceptance test thao tác DOM và kiểm tra strategy `SKIP`, kết quả thành công |
| File sai định dạng và preview hết hạn | Đạt | Acceptance test kiểm tra thông báo, mã tra cứu và không gọi preview khi file sai |
| Lọc, xem metadata và phân trang Audit log | Đạt | Acceptance test kiểm tra action `STUDENT_IMPORT_COMMIT`, request ID, metadata và trang 2 |
| Tài khoản thiếu quyền Audit | Đạt | Trang hiển thị lỗi `audit.read`; API integration trả `403` |
| Demo trực tiếp bằng tài khoản có quyền | Đạt | Chạy ngày 13/09/2026 trên `ba80759` chứa `ffa38f5`; kiểm tra trùng/FAIL chạy lại trên `777c3f9` |

## Cảnh báo không chặn Sprint 3

Web build thành công nhưng Node.js 24 phát cảnh báo `DEP0155` từ dependency gián tiếp `@nuxt/nitro-server` và `@vue/shared`. Cảnh báo đã được theo dõi trong README và không phát sinh từ mã ứng dụng.

## Điều kiện hoàn tất S3 12

- [x] API typecheck, unit test, integration test và build thành công.
- [x] Web unit test, acceptance test và build thành công.
- [x] Route Import và Audit bảo vệ session đúng khi chưa đăng nhập.
- [x] Luồng Import từ chọn file đến preview/confirm được bao phủ ở trang Nuxt và API thật.
- [x] Audit log được bao phủ gồm lọc, phân trang và xem metadata.
- [x] Thiếu quyền được bao phủ ở cả phản hồi API và trạng thái giao diện.
- [x] Web test được thêm vào CI để duy trì hồi quy sau Sprint 3.

## Bàn giao S3 13

- [x] README phản ánh baseline kỹ thuật local, trạng thái chưa production-ready/deployed và nghiệm thu có điều kiện.
- [x] Runbook mô tả đầy đủ thứ tự demo, kết quả mong đợi và biểu mẫu ký nghiệm thu.
- [x] Script `scripts/sprint-3-demo.ps1` tạo dữ liệu CSV không trùng cho từng lần demo và kiểm tra API/Web local.
- [x] Chạy lại demo trực tiếp trên baseline chứa `ffa38f5`; bằng chứng định danh chỉ dùng dữ liệu giả.
- [ ] Người có thẩm quyền ký biên bản nghiệm thu Sprint 3.
- [x] Hardening import P0.1–P0.5 đã triển khai và được tái kiểm chứng tự động trên PostgreSQL thật.
- [ ] Chốt nghiệm thu chính thức sau chữ ký; hiện đã đủ bằng chứng kỹ thuật và demo.

## Bằng chứng demo trực tiếp ngày 13/09/2026

Luồng chính được chạy trên Web local bằng `system.admin`. File demo `students-1789286977.csv` chỉ chứa dữ liệu giả của lớp `QLGD-K15A`.

| Kịch bản | Kết quả | Bằng chứng quan sát |
| --- | --- | --- |
| Preview và confirm file sạch | Đạt | Preview 2 dòng hợp lệ, 0 lỗi, 0 trùng; confirm `FAIL` tạo 2 sinh viên, request ID `req-78` |
| Đồng bộ thông tin học vụ | Đạt | Mã `1789286977` và `1789286978` hiển thị lớp `QLGD-K15A`, khoa `QLGD`, trạng thái Chờ kích hoạt |
| Tải lại file và dừng khi trùng | Đạt | Preview 0 hợp lệ, 0 lỗi, 2 trùng; `FAIL` từ chối commit với request ID `req-k`; tổng sinh viên và số audit commit thành công không đổi |
| Audit Import | Đạt | Sự kiện `STUDENT_IMPORT_COMMIT` thành công lưu file/strategy và kết quả `imported=2`, `processed=2`, `updated=0`, `skipped=0`; không có token/mật khẩu trong metadata |
| Phân trang Audit | Đạt | Chuyển từ trang 1 sang trang 2; trạng thái nút trước/sau cập nhật đúng |
| Invitation worker | Đạt | Worker riêng chạy với SMTP local và Mailpit nhận đủ 2 email kích hoạt demo |
| Audit gửi email | Đạt | Có 2 sự kiện `INVITATION_EMAIL_SENT` thành công sau khi worker xử lý; token không xuất hiện trong audit |
| Export theo bộ lọc | Đạt | Request export theo lớp trả 200; workbook có 4 dòng thuộc `QLGD-K15A`, không lẫn lớp khác, mọi mã định danh ở định dạng Text |
| Excel mẫu | Đạt | Workbook có đúng bốn cột import; các mã mẫu `00123456` và `00123457` là chuỗi với định dạng Text nên giữ số 0 đầu |
| RBAC/scope | Đạt | Trang phân quyền hiển thị `system.admin` ở scope `GLOBAL` và các tài khoản demo theo scope; danh sách sinh viên chỉ hiển thị dữ liệu trong scope |

Trong demo, lazy cleanup preview hết hạn làm lộ một lỗi ràng buộc giữa job `SUCCEEDED` và `preview_id`. Lỗi được sửa tại `777c3f9` bằng migration `0013_allow-expired-import-preview.sql`, kèm integration test hồi quy. Sau sửa, toàn bộ test/build bên dưới đều đạt. Kiểm tra thủ công thao tác sửa sinh viên và cửa sổ ẩn danh không lặp lại trong phiên này; các nhánh đó vẫn có integration/acceptance test tương ứng.

## Kết luận tái kiểm chứng ngày 13/09/2026

- API typecheck và production build trên tree tách riêng của `ffa38f5`: đạt.
- API unit test: 80 đạt, 0 lỗi.
- API integration test trên PostgreSQL 17 sạch: 153 đạt, 0 lỗi.
- Web unit test: 26 đạt, 0 lỗi.
- Web acceptance test: 5 đạt, 0 lỗi.
- Web production build: đạt.
- Trạng thái P0 import: P0.1–P0.5 đạt local.
- Trạng thái phát hành: Import API chưa production-ready/deployed.
- Trạng thái Sprint 3: demo và bằng chứng kỹ thuật đã hoàn tất; chờ duy nhất chữ ký người có thẩm quyền để nghiệm thu chính thức.
