# Biên bản kiểm thử Sprint 3

## Phạm vi và kết luận hiện tại

Biên bản này ghi lại bằng chứng hồi quy cho increment Sprint 3 trên môi trường local sau các commit chức năng `c38d802`, `7928102` và `a419725`. API typecheck, unit test, integration test, Web unit/acceptance test và production build đều đạt.

S3-12 được kiểm chứng bằng hai lớp bổ trợ nhau: integration test gọi API thật với database test và acceptance test gắn các trang Nuxt trong DOM rồi thao tác như người dùng. Cách này kiểm tra đủ upload → preview → confirm, lọc → xem metadata → phân trang và trạng thái thiếu quyền mà không thay đổi mật khẩu `system.admin`. Demo trực tiếp trên trình duyệt bằng tài khoản local thuộc bước nghiệm thu S3-13; bộ test hiện tại không được mô tả là Playwright full-stack.

## Môi trường kiểm thử

- Ngày kiểm tra: 09/09/2026.
- Nhánh: `main`.
- Commit chức năng: `c38d802`.
- API: Node.js, Fastify và PostgreSQL 17.
- Web: Nuxt 4.5.2, Vue 3.5.41 và Vite 8.2.2.
- PostgreSQL test: container `student-service-postgres-test`, database dùng `tmpfs`.
- Development local: API `http://localhost:3000`, Web `http://localhost:3001`, Mailpit `http://localhost:8025`.

## Kết quả tự động

| Hạng mục | Kết quả | Bằng chứng |
| --- | --- | --- |
| API typecheck | Đạt | `npm run typecheck --workspace @student-service/api` |
| API unit test | 75 đạt, 0 lỗi | `npm run test:unit --workspace @student-service/api` |
| API integration test | 149 đạt, 0 lỗi | `npm run test:integration --workspace @student-service/api` |
| API production build | Đạt | `npm run build --workspace @student-service/api` |
| Web unit test | 19 đạt, 0 lỗi | `npm run test --workspace @student-service/web` |
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
| Demo trực tiếp bằng tài khoản có quyền | Chuyển S3-13 | Product Owner thực hiện nghiệm thu trên môi trường local |

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
