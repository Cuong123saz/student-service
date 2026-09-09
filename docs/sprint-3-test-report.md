# Biên bản kiểm thử Sprint 3

## Phạm vi và kết luận hiện tại

Biên bản này ghi lại bằng chứng hồi quy cho increment Sprint 3 trên môi trường local tại commit `c38d802`. Typecheck, unit test, integration test và production build đều đạt. Kiểm tra E2E trình duyệt đã xác nhận các route quản trị chuyển về trang đăng nhập khi chưa có session và không phát sinh lỗi console.

Luồng E2E có đăng nhập, upload file và confirm import chưa được đánh dấu hoàn thành cho đến khi người kiểm thử đăng nhập bằng tài khoản local có đủ quyền. Không thay đổi hoặc đặt lại mật khẩu `system.admin` chỉ để chạy kiểm thử.

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
| API integration test | 148 đạt, 0 lỗi | `npm run test:integration --workspace @student-service/api` |
| API production build | Đạt | `npm run build --workspace @student-service/api` |
| Web unit test | 19 đạt, 0 lỗi | `npx --no-install vitest run --reporter=verbose` trong `apps/web` |
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

## Kiểm tra trình duyệt local

| Kịch bản | Trạng thái | Kết quả |
| --- | --- | --- |
| Mở `/admin/students/import` khi chưa đăng nhập | Đạt | Chuyển về `/admin/login` |
| Mở `/admin/audit-logs` khi chưa đăng nhập | Đạt | Chuyển về `/admin/login` |
| Lỗi console tại trang đăng nhập | Đạt | Không có lỗi hoặc cảnh báo |
| Đăng nhập bằng tài khoản có quyền | Chờ thao tác | Cần người dùng nhập mật khẩu local |
| Upload, preview và confirm import trên Web | Chờ thao tác | Thực hiện sau khi có session hợp lệ |
| Lọc và phân trang Audit log trên Web | Chờ thao tác | Thực hiện sau khi có session hợp lệ |
| Tài khoản thiếu quyền nhận `403` trên Web | Chờ thao tác | Cần tài khoản local phù hợp hoặc fixture E2E chuyên dụng |

## Cảnh báo không chặn Sprint 3

Web build thành công nhưng Node.js 24 phát cảnh báo `DEP0155` từ dependency gián tiếp `@nuxt/nitro-server` và `@vue/shared`. Cảnh báo đã được theo dõi trong README và không phát sinh từ mã ứng dụng.

## Điều kiện hoàn tất S3 12

- [x] API typecheck, unit test, integration test và build thành công.
- [x] Web unit test và build thành công.
- [x] Route Import và Audit bảo vệ session đúng khi chưa đăng nhập.
- [ ] E2E Web import từ upload đến confirm bằng tài khoản có quyền.
- [ ] E2E Web audit log gồm lọc, phân trang và xem metadata.
- [ ] Kiểm tra Web với tài khoản thiếu quyền.
