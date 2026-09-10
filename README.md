# Student Service Portal

Cổng Dịch vụ Sinh viên của Học viện Quản lý Giáo dục, được xây dựng dưới dạng monorepo TypeScript. Hệ thống hướng tới một nơi thống nhất để sinh viên tra cứu dịch vụ, thực hiện thủ tục, quản lý hồ sơ học vụ, điểm rèn luyện, hoạt động ngoại khóa và nghiên cứu khoa học.

> Trạng thái hiện tại: Sprint 3 đã hoàn thành và được nghiệm thu lại trên môi trường local ngày 10/09/2026. Các hạng mục hardening P0 của luồng import đã hoàn tất; dự án vẫn chưa triển khai production và cần một đợt production-readiness riêng cho backup, monitoring và hạ tầng vận hành.

## Trạng thái dự án

### Sprint 1 — Danh mục dịch vụ

- Hiển thị danh sách dịch vụ sinh viên.
- Lọc dịch vụ theo trạng thái `ACTIVE` hoặc `INACTIVE`.
- Xem chi tiết dịch vụ.
- Nuxt xử lý loading, empty và error state.
- Có integration test cho API dịch vụ bằng `Fastify.inject()`.

### Sprint 2 — Identity và hồ sơ sinh viên

- Một hệ thống danh tính dùng chung, nhưng tách session và audience giữa cổng quản trị và cổng người dùng.
- Đăng nhập, đăng xuất và lấy thông tin session hiện tại cho admin và sinh viên.
- Bắt buộc admin đổi mật khẩu tạm ở lần đăng nhập tiếp theo.
- Admin tạo tài khoản theo role; tài khoản sinh viên bắt buộc có mã sinh viên và lớp hợp lệ.
- Gửi email kích hoạt, đặt mật khẩu lần đầu và gửi lại lời mời.
- Token kích hoạt dùng một lần, có thời hạn và chỉ lưu SHA-256 hash trong database.
- Transaction chống hai request cùng kích hoạt một tài khoản.
- Hồ sơ sinh viên, khoa, lớp và phân công cố vấn theo thời gian hiệu lực.
- API hồ sơ cá nhân và xác định cố vấn hiện hành.
- Bảo vệ route theo role với phản hồi `401` và `403`.
- Audit log cho tạo tài khoản, gán role và các thay đổi dữ liệu quan trọng.
- Helmet, CORS theo môi trường, rate limit cho route nhạy cảm và global error handler.
- Giao diện public, đăng nhập, kích hoạt tài khoản, portal sinh viên, hồ sơ cá nhân và trang quản trị cơ bản.

### Sprint 3 — Hoàn thành

- Nền tảng permission và ánh xạ role-permission — đã hoàn thành.
- Nền tảng scope `GLOBAL`/`FACULTY`/`CLASS`/`ORGANIZATION` — đã hoàn thành.
- Danh sách người dùng, gán role hệ thống và scope theo thẩm quyền — đã hoàn thành.
- Chỉnh catalog role-permission với bảo vệ SYSTEM_ADMIN và audit transaction — đã hoàn thành.
- Quản lý khoa, lớp và phân công cố vấn trên giao diện admin — đã hoàn thành.
- Quản lý đơn vị hành chính và scope tương ứng trên giao diện admin — đã hoàn thành.
- API import Excel/CSV theo luồng upload → preview → confirm → transaction, có báo lỗi theo dòng và ba chiến lược xử lý trùng — đã hoàn thành.
- Export Excel theo quyền và phạm vi dữ liệu — đã hoàn thành.
- Gửi lời mời hàng loạt qua PostgreSQL job queue — đã hoàn thành.
- Giao diện import gồm preview, báo lỗi, xử lý trùng và confirm — đã hoàn thành.
- Giao diện tra cứu audit log theo hành động và phân trang thời gian — đã hoàn thành.
- Hồi quy API/Web và acceptance test cho Import/Audit — đã hoàn thành.
- Runbook, script demo, kiểm thử trực tiếp và biên bản nghiệm thu — đã hoàn thành.

Các module biểu mẫu thủ tục, workflow, sinh tài liệu, chữ ký số và điểm rèn luyện thuộc các sprint sau; không đưa vào Sprint 3.

Ma trận quyền mặc định và các quyết định bảo mật của RBAC được ghi tại [`docs/authorization-matrix.md`](docs/authorization-matrix.md).
Mô hình phạm vi dữ liệu được ghi tại [`docs/data-scope-model.md`](docs/data-scope-model.md).
Kịch bản demo và biểu mẫu nghiệm thu được ghi tại [`docs/sprint-3-demo-runbook.md`](docs/sprint-3-demo-runbook.md).

## Luồng đã chạy được

### Admin

```text
Tạo SYSTEM_ADMIN
→ đăng nhập cổng quản trị
→ tạo lời mời sinh viên
→ hệ thống gửi email kích hoạt
→ xem audit log
→ đăng xuất
```

### Sinh viên

```text
Nhận email kích hoạt
→ mở liên kết kích hoạt
→ đặt mật khẩu
→ đăng nhập cổng sinh viên
→ xem hồ sơ cá nhân
→ xem cố vấn hiện hành
→ đăng xuất
```

## Kiến trúc

Dự án sử dụng modular monolith. Các module nghiệp vụ được tách trong một Fastify API và dùng chung PostgreSQL; chưa tách microservice ở giai đoạn hiện tại.

```text
student-service/
├── apps/
│   ├── api/
│   │   ├── drizzle/          Database migrations
│   │   └── src/
│   │       ├── config/       Environment configuration
│   │       ├── db/           Drizzle schema, client và seed
│   │       ├── http/         Global HTTP concerns
│   │       └── modules/
│   │           ├── audit/
│   │           ├── auth/
│   │           ├── organizations/
│   │           ├── services/
│   │           └── users/
│   └── web/
│       └── app/
│           ├── assets/
│           ├── components/
│           ├── composables/
│           ├── layouts/
│           ├── middleware/
│           ├── pages/
│           └── types/
├── docker-compose.yml
├── docker-compose.test.yml
├── package-lock.json
└── package.json
```

## Công nghệ

- TypeScript
- Fastify 5
- Nuxt 4 và Vue 3
- PostgreSQL 17
- Drizzle ORM và Drizzle Kit
- Node.js test runner
- Argon2
- Nodemailer và Mailpit
- Docker Compose
- npm workspaces

## Yêu cầu môi trường

- Node.js 22 trở lên.
- npm.
- Docker Desktop có Docker Compose.
- PowerShell cho các ví dụ lệnh bên dưới.

## Bắt đầu nhanh

### 1. Cài dependency

Tại thư mục gốc dự án:

```powershell
cd D:\student-service
npm install
```

### 2. Tạo cấu hình local

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/api/.env.test.example apps/api/.env.test
```

Giá trị mặc định trong file mẫu phù hợp với Docker Compose của dự án. Hãy thay `JWT_SECRET` trong `apps/api/.env` bằng chuỗi ngẫu nhiên dài ít nhất 32 ký tự.

Không commit `.env`, mật khẩu, JWT secret, token, connection string production hoặc khóa ký số.

### 3. Khởi động PostgreSQL và Mailpit

Volume development đang được khai báo là external. Lệnh tạo volume có thể chạy lại an toàn:

```powershell
docker volume create student-service-api_student_service_data
docker compose up -d
docker compose ps
```

Các dịch vụ local:

| Thành phần | Địa chỉ |
| --- | --- |
| PostgreSQL development | `localhost:5433` |
| SMTP Mailpit | `localhost:1025` |
| Mailpit Web UI | `http://localhost:8025` |

### 4. Chạy migration development

Drizzle config nằm trong workspace API, vì vậy hãy chạy lệnh tại đúng thư mục:

```powershell
cd D:\student-service\apps\api
npm exec -- drizzle-kit migrate --config=drizzle.config.ts
cd D:\student-service
```

### 5. Seed dữ liệu demo

```powershell
npm run db:seed --workspace @student-service/api
```

Seed có thể chạy lại mà không tạo dữ liệu trùng và bị chặn khi `APP_ENV=production`. Dữ liệu demo gồm:

- Các system role.
- Ba dịch vụ sinh viên.
- Khoa `QLGD`.
- Lớp `QLGD-K15A`.
- Một cố vấn active của lớp.

Sau khi hoàn thành, seed in ra `classId` dùng khi tạo lời mời cho sinh viên.

### 6. Tạo tài khoản SYSTEM_ADMIN

Chỉ chạy bootstrap khi database chưa có tài khoản `SYSTEM_ADMIN`:

```powershell
$env:BOOTSTRAP_ADMIN_USERNAME = "system.admin"
$env:BOOTSTRAP_ADMIN_FULL_NAME = "Quản trị hệ thống"

$securePassword = Read-Host `
  "Nhập mật khẩu SYSTEM_ADMIN (tối thiểu 15 ký tự)" `
  -AsSecureString

$env:BOOTSTRAP_ADMIN_PASSWORD = `
  [System.Net.NetworkCredential]::new(
    "",
    $securePassword
  ).Password

npm run auth:bootstrap-admin --workspace @student-service/api

Remove-Item Env:BOOTSTRAP_ADMIN_USERNAME
Remove-Item Env:BOOTSTRAP_ADMIN_FULL_NAME
Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD
```

Script từ chối tạo thêm nếu đã tồn tại một `SYSTEM_ADMIN`.

### 7. Chạy API và Web

Tại thư mục gốc:

```powershell
npm run dev
```

Hoặc chạy riêng:

```powershell
npm run dev:api
npm run dev:web
```

Sau khi import sinh viên, mở thêm một terminal để chạy worker gửi email kích hoạt qua Mailpit/SMTP:

```powershell
npm run invitations:worker --workspace @student-service/api
```

Worker claim job bằng khóa hàng `SKIP LOCKED`, tự retry tối đa 3 lần với backoff và thu hồi job bị treo quá 5 phút. Để xử lý tối đa một job khi kiểm tra local, dùng `npm run invitations:worker:once --workspace @student-service/api`.

| Khu vực | Địa chỉ |
| --- | --- |
| Trang chủ | `http://localhost:3001` |
| Danh mục dịch vụ | `http://localhost:3001/services` |
| Đăng nhập sinh viên | `http://localhost:3001/login` |
| Đăng nhập quản trị | `http://localhost:3001/admin/login` |
| Danh sách sinh viên | `http://localhost:3001/admin/students` |
| Import sinh viên | `http://localhost:3001/admin/students/import` |
| Audit log | `http://localhost:3001/admin/audit-logs` |
| Tạo lời mời sinh viên | `http://localhost:3001/admin/users/invite` |
| API | `http://localhost:3000` |

Email gửi trong môi trường local được giữ tại Mailpit. Mở `http://localhost:8025` để lấy liên kết kích hoạt thay vì kiểm tra Gmail thật.

## Khôi phục mật khẩu SYSTEM_ADMIN

Chỉ sử dụng khi quên mật khẩu admin. Mật khẩu được đặt ở đây là mật khẩu tạm; admin phải đổi lại sau khi đăng nhập.

```powershell
$env:ALLOW_ADMIN_PASSWORD_RECOVERY = "true"
$env:RECOVERY_ADMIN_USERNAME = "system.admin"

$securePassword = Read-Host `
  "Nhập mật khẩu tạm mới (tối thiểu 15 ký tự)" `
  -AsSecureString

$env:RECOVERY_ADMIN_PASSWORD = `
  [System.Net.NetworkCredential]::new(
    "",
    $securePassword
  ).Password

npm run auth:recover-admin --workspace @student-service/api

Remove-Item Env:ALLOW_ADMIN_PASSWORD_RECOVERY
Remove-Item Env:RECOVERY_ADMIN_USERNAME
Remove-Item Env:RECOVERY_ADMIN_PASSWORD
```

Không lưu các biến recovery trong `.env`.

Nếu tài khoản `SYSTEM_ADMIN` bị chuyển khỏi trạng thái `ACTIVE`, thêm biến sau trước khi chạy lệnh recovery để xác nhận chủ đích khôi phục cả trạng thái:

```powershell
$env:RECOVER_ADMIN_STATUS = "true"
```

Sau khi hoàn tất, xóa biến bằng `Remove-Item Env:RECOVER_ADMIN_STATUS`. Nếu không có xác nhận này, script từ chối tự kích hoạt lại tài khoản.

## API hiện có

### Public

| Method | Endpoint | Mô tả |
| --- | --- | --- |
| `GET` | `/services` | Danh sách dịch vụ |
| `GET` | `/services?status=ACTIVE` | Lọc dịch vụ theo trạng thái |
| `GET` | `/services/:id` | Chi tiết dịch vụ |
| `POST` | `/api/v1/auth/activate` | Kích hoạt tài khoản và đặt mật khẩu |

### Cổng người dùng

| Method | Endpoint | Mô tả |
| --- | --- | --- |
| `POST` | `/api/v1/user/auth/login` | Đăng nhập |
| `GET` | `/api/v1/user/auth/me` | Lấy session hiện tại |
| `POST` | `/api/v1/user/auth/logout` | Đăng xuất |
| `GET` | `/api/v1/user/profile` | Hồ sơ sinh viên |
| `GET` | `/api/v1/user/advisor` | Cố vấn hiện hành hoặc trạng thái chưa phân công |

### Cổng quản trị

| Method | Endpoint | Mô tả |
| --- | --- | --- |
| `POST` | `/api/v1/admin/auth/login` | Đăng nhập admin |
| `GET` | `/api/v1/admin/auth/me` | Lấy session admin |
| `POST` | `/api/v1/admin/auth/change-password` | Đổi mật khẩu |
| `POST` | `/api/v1/admin/auth/logout` | Đăng xuất |
| `POST` | `/api/v1/admin/users/invitations` | Tạo tài khoản và lời mời |
| `POST` | `/api/v1/admin/users/:userId/invitations/resend` | Gửi lại lời mời |
| `GET` | `/api/v1/admin/academic-catalog` | Khoa/lớp đang hoạt động theo permission và scope |
| `GET` | `/api/v1/admin/students` | Danh sách sinh viên theo permission và scope |
| `PATCH` | `/api/v1/admin/students/:userId` | Sửa tên, mã sinh viên dạng số và khoa/lớp trong phạm vi `student.update` |
| `GET` | `/api/v1/admin/students/import-template.xlsx` | Tải file Excel mẫu theo cấu trúc import, yêu cầu `student.import` |
| `POST` | `/api/v1/admin/students/imports/preview` | Upload `.xlsx`/`.csv`, kiểm tra và xem trước; không ghi database |
| `POST` | `/api/v1/admin/students/imports/:previewId/confirm` | Xác nhận import với chiến lược `SKIP`, `OVERWRITE` hoặc `FAIL` |
| `GET` | `/api/v1/admin/students/export.xlsx` | Export Excel theo bộ lọc, permission `student.export` và scope được giao |
| `GET` | `/api/v1/admin/audit-logs` | Tra cứu audit log |

Cookie session được gửi tự động bởi trình duyệt. Khi gọi API từ frontend hoặc công cụ kiểm thử, request phải cho phép credentials/cookie.

### Định dạng import sinh viên

- File tối đa 5 MiB và 1.000 dòng dữ liệu; chỉ đọc worksheet đầu tiên của `.xlsx`.
- CSV phải dùng UTF-8, hỗ trợ dấu phẩy hoặc dấu chấm phẩy và giá trị được bao bởi dấu nháy kép.
- Bốn cột bắt buộc: `studentCode`, `fullName`, `email`, `classCode`. Header tiếng Việt tương ứng như `Mã sinh viên`, `Họ và tên`, `Mã lớp` cũng được chấp nhận.
- `username` được suy ra từ mã sinh viên đã chuẩn hóa sang chữ thường.
- Trùng trong file và trùng với hệ thống được báo riêng theo `studentCode` và `email`.
- Preview tồn tại 15 phút, gắn với admin đã upload và chỉ được consume một lần khi commit thành công.
- Preview có dòng sai validation sẽ không được confirm; cần sửa file và upload lại.

### Export danh sách sinh viên

- Hỗ trợ cùng các bộ lọc `status`, `facultyId`, `classId` và `search` như danh sách quản trị.
- Backend kiểm tra `student.export` ở route và tiếp tục giới hạn dữ liệu theo scope `GLOBAL`, `FACULTY` hoặc `CLASS` tại repository.
- File `.xlsx` giữ mã sinh viên dưới dạng text, có hàng tiêu đề, cố định hàng đầu và bộ lọc cột.
- Mỗi file giới hạn 10.000 sinh viên để tránh dùng bộ nhớ không kiểm soát; nếu vượt giới hạn, API trả `413` để người dùng thu hẹp bộ lọc.
- Hành động export chỉ trả file sau khi audit `STUDENT_EXPORT` được ghi thành công.

## Kiểm thử

### Unit test

Unit test không cần PostgreSQL:

```powershell
npm run test:unit --workspace @student-service/api
```

### Integration test

Khởi động database test:

```powershell
docker compose -f docker-compose.test.yml up -d
docker compose -f docker-compose.test.yml ps
```

Chạy integration test:

```powershell
npm run test:integration --workspace @student-service/api
```

Script tự chạy migration bằng `drizzle.test.config.ts`. Database test dùng `tmpfs`, vì vậy dữ liệu không được giữ lại khi container bị xóa và tạo lại.

### Toàn bộ API test

```powershell
npm run test --workspace @student-service/api
```

### Web unit và acceptance test

```powershell
npm run test --workspace @student-service/web
```

Bộ acceptance test của Web chạy trang Nuxt trong DOM test, bao phủ thao tác chọn file → preview → confirm, lỗi file không hỗ trợ/preview hết hạn, Audit log lọc → xem metadata → phân trang và trạng thái thiếu quyền. Có thể chạy riêng lớp này bằng `npm run test:acceptance --workspace @student-service/web`.

## Typecheck và build

```powershell
npm run typecheck --workspace @student-service/api
npm run build --workspace @student-service/api
npm run build --workspace @student-service/web
```

Build API được tạo tại `apps/api/dist`. Build Nuxt được tạo trong thư mục do Nuxt quản lý và không được commit.

Kết quả hồi quy và acceptance test Sprint 3 được ghi tại [`docs/sprint-3-test-report.md`](docs/sprint-3-test-report.md).

## Continuous Integration

Workflow `.github/workflows/ci.yml` tự chạy API typecheck, unit/integration test, API build, Web unit/acceptance test và Web build trên mỗi pull request và mỗi lần push lên `main`. PostgreSQL test được tạo riêng trong runner; CI không dùng database development.

## Migration workflow

Sau khi sửa Drizzle schema, tạo migration tại workspace API:

```powershell
cd D:\student-service\apps\api
npm exec -- drizzle-kit generate --config=drizzle.config.ts --name=ten-migration
```

Trước khi migrate:

1. Review SQL trong `apps/api/drizzle`.
2. Không sửa hoặc xóa migration đã được dùng trên database chia sẻ.
3. Chạy migration trên database test.
4. Chạy typecheck, build và regression test.

## Nguyên tắc bảo mật

- Mật khẩu chỉ lưu dưới dạng hash; không log hoặc trả mật khẩu về client.
- Admin session và user session dùng cookie HttpOnly riêng, audience riêng và thời hạn riêng.
- Admin session hiện có thời hạn 15 phút; user session có thời hạn 2 giờ.
- Token kích hoạt raw chỉ xuất hiện trong email; database chỉ lưu SHA-256 hash.
- Token kích hoạt có purpose, thời hạn, revoke/consume và chỉ được dùng một lần.
- Các thay đổi nhạy cảm sử dụng transaction và audit log.
- Frontend có thể ẩn nút theo role, nhưng authorization thật luôn nằm ở Fastify.
- Global error handler không trả stack trace hoặc thông tin lỗi nội bộ cho client.
- CORS origin, database URL, SMTP và JWT secret lấy từ biến môi trường.
- Chữ ký số là bước xác thực tài liệu riêng, không đồng nhất với đăng nhập.

## Nợ kỹ thuật đã biết

Các mục dưới đây không làm mất giá trị increment Sprint 2 nhưng phải được theo dõi trong Sprint 3 hoặc các sprint gần nhất:

- Route danh mục dịch vụ vẫn dùng `/services`; các module mới đã dùng `/api/v1`.
- Root `package.json` hiện chỉ có lệnh chạy development; build, test và check vẫn chạy theo từng workspace.
- Test integration vẫn liệt kê thủ công từng file test.
- Một số repository vẫn import database client trực tiếp; chưa có Fastify database plugin dùng chung.
- Chưa có refresh session và cơ chế thu hồi session theo từng thiết bị.
- JWT tiếp tục chứa role; permission và scope được kiểm tra lại từ database để thay đổi quyền hoặc khóa tài khoản có hiệu lực ngay.
- Preview import đang lưu trong bộ nhớ của một API process. Khi triển khai nhiều instance cần chuyển sang kho dùng chung có TTL (ví dụ Redis) để confirm không phụ thuộc instance nhận request.
- XLSX hiện chỉ đọc worksheet đầu tiên; chưa hỗ trợ chọn sheet hoặc ánh xạ cột tùy biến.
- Tài khoản mới từ import được tạo ở trạng thái `INVITED` và enqueue lời mời trong cùng transaction. Worker email đang chạy như process riêng; chưa có dashboard theo dõi/retry thủ công các job `FAILED` trên giao diện admin.
- Web build trên Node.js 24 hiện phát cảnh báo `DEP0155` khi template lỗi của dependency gián tiếp `@nuxt/nitro-server@4.5.2` phân giải dependency gián tiếp `@vue/shared@3.5.41`. Hai package này đi vào qua dependency trực tiếp `nuxt` của workspace `apps/web`, không thuộc `apps/api` hay tooling riêng của monorepo. Build vẫn thành công; theo dõi bản nâng cấp Nuxt/Vue tương thích thay vì sửa trực tiếp `node_modules`.
- API audit log hiện chỉ hỗ trợ lọc theo `action` và cursor thời gian `before`; chưa hỗ trợ lọc theo người thực hiện, đối tượng hoặc khoảng ngày. Danh sách action trên giao diện đang là catalog tĩnh và phải cập nhật khi backend bổ sung action mới.
- Quyền `audit.read` hiện cho phép đọc audit log toàn hệ thống, chưa giới hạn theo khoa, lớp hoặc đơn vị. Product Owner và backend phải chốt chính sách scope trước khi cấp quyền này rộng rãi ở môi trường dùng chung/production.
- Thu thập log ngoài máy local chưa cần triển khai khi dự án chưa lên môi trường dùng chung.

## Quy ước đóng góp

- Không commit file `.env` hoặc dữ liệu bí mật.
- Không chỉnh migration cũ đã được áp dụng; tạo migration mới.
- Route chỉ xử lý HTTP; nghiệp vụ đặt trong service/policy và truy vấn đặt trong repository.
- Mọi route mới phải có validation request/response.
- Thay đổi liên quan quyền cần test `401` và `403`.
- Thay đổi dữ liệu quan trọng phải có audit log.
- Trước khi commit, chạy typecheck, build và các test liên quan.

## Phạm vi triển khai

Agile không bắt buộc deploy production sau mỗi sprint. Definition of Done hiện tại yêu cầu build, migration, test và demo thành công trên local. Production deployment, backup, monitoring và hardening toàn diện sẽ được thực hiện khi dự án bước vào giai đoạn phù hợp.
