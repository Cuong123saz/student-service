# Student Service

Cổng dịch vụ sinh viên được xây dựng dưới dạng monorepo TypeScript. Hệ thống hướng tới việc cho phép sinh viên tra cứu và thực hiện thủ tục trực tuyến; cán bộ, giảng viên cố vấn và người ký xử lý hồ sơ theo quyền được phân công.

> Trạng thái hiện tại: triển khai và kiểm thử trên môi trường local, chưa triển khai production.

## Phạm vi hiện tại

### Sprint 1 — Service catalog

- Danh sách dịch vụ sinh viên.
- Lọc dịch vụ theo trạng thái `ACTIVE` hoặc `INACTIVE`.
- Xem chi tiết dịch vụ.
- Nuxt hiển thị trạng thái loading, empty và error.
- Integration test cho các API dịch vụ bằng `Fastify.inject()`.

### Sprint 2 — Identity, tổ chức học vụ và hồ sơ sinh viên

- Xác thực dùng chung, tách cookie/session và audience cho cổng quản trị và cổng người dùng.
- Đăng nhập, đăng xuất, lấy session hiện tại và bắt buộc admin đổi mật khẩu tạm.
- Phân quyền route theo role; backend không tin quyền do frontend tự khai báo.
- Admin tạo tài khoản theo role. Sinh viên bắt buộc có `studentCode` và `classId` hợp lệ.
- Gửi email kích hoạt, đặt mật khẩu lần đầu và gửi lại lời mời khi email thất bại.
- Token một lần chỉ lưu SHA-256 hash, có thời hạn, revoke/consume và chống hai token cùng sống.
- Transaction tạo đồng thời user, role, hồ sơ sinh viên, token và audit bắt buộc.
- Khoa, lớp, cố vấn học tập và phân công cố vấn có hiệu lực theo thời gian.
- Trang “Hồ sơ của tôi” hiển thị hồ sơ học vụ và trạng thái cố vấn được/chưa được phân công.
- Audit log bất biến có `metadata` và snapshot `before`/`after` nullable.
- Global error handler, security headers và rate limit cho các route nhạy cảm.

Sprint 2 được triển khai và kiểm thử cho môi trường local. Màn hình quản lý đầy đủ khoa/lớp,
import Excel và giao diện tra cứu audit được để sang Sprint 3 trở đi.

## Kiến trúc

```text
student-service/
├── apps/
│   ├── api/        Fastify API, Drizzle ORM và PostgreSQL
│   └── web/        Nuxt frontend
├── docker-compose.yml
├── docker-compose.test.yml
└── package.json    npm workspaces và lệnh chạy chung
```

Dự án sử dụng kiến trúc modular monolith. Mỗi nghiệp vụ lớn sẽ là một module trong Fastify; không tách microservice ở giai đoạn hiện tại.

## Công nghệ

- TypeScript
- Fastify
- Nuxt và Vue
- PostgreSQL 17
- Drizzle ORM và Drizzle Kit
- Node.js test runner
- Argon2id
- Docker Compose
- npm workspaces

## Yêu cầu môi trường

- Node.js 22 trở lên
- npm
- Docker Desktop có Docker Compose

## Cài đặt

Tại thư mục gốc dự án:

```powershell
cd D:\student-service
npm install
```

Tạo file cấu hình development cho API:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

Tạo file cấu hình test cho API:

```powershell
Copy-Item apps/api/.env.test.example apps/api/.env.test
```

Các file `.env` thật chỉ dùng trên máy local và không được commit.

## Khởi tạo database development

Khởi động PostgreSQL development:

```powershell
docker compose up -d
docker compose ps
```

PostgreSQL development chạy tại `localhost:5433`.

Chạy migration:

```powershell
cd D:\student-service\apps\api
npm exec -- drizzle-kit migrate --config=drizzle.config.ts
```

Seed dữ liệu ban đầu:

```powershell
cd D:\student-service
npm run db:seed --workspace @student-service/api
```

Seed được thiết kế để có thể chạy lại mà không tạo dữ liệu trùng và bị chặn khi
`APP_ENV=production`. Seed tạo dữ liệu demo tối thiểu gồm một khoa, một lớp và một cố vấn
đang phụ trách; lệnh sẽ in `classId` dùng cho form mời sinh viên.

## Chạy ứng dụng

Tại thư mục gốc:

```powershell
npm run dev
```

Địa chỉ local:

| Thành phần | Địa chỉ |
| --- | --- |
| Web | `http://localhost:3001` |
| API | `http://localhost:3000` |
| PostgreSQL development | `localhost:5433` |
| PostgreSQL test | `localhost:5434` |

Có thể chạy riêng từng ứng dụng:

```powershell
npm run dev:api
npm run dev:web
```

## API hiện có

```text
GET /services
GET /services?status=ACTIVE
GET /services/:id

POST /api/v1/admin/auth/login
GET  /api/v1/admin/auth/me
POST /api/v1/admin/auth/logout
POST /api/v1/admin/auth/change-password

POST /api/v1/user/auth/login
GET  /api/v1/user/auth/me
POST /api/v1/user/auth/logout

POST /api/v1/auth/activate
POST /api/v1/admin/users/invitations
POST /api/v1/admin/users/:userId/invitations/resend

GET /api/v1/user/profile
GET /api/v1/user/advisor
GET /api/v1/admin/audit-logs
```

## Kiểm thử

### Unit test

Unit test không cần Fastify hoặc PostgreSQL:

```powershell
npm run test:unit --workspace @student-service/api
```

### Integration test

Khởi động PostgreSQL test:

```powershell
docker compose -f docker-compose.test.yml up -d
docker compose -f docker-compose.test.yml ps
```

Sau đó chạy:

```powershell
npm run test --workspace @student-service/api
```

Script integration test tự chạy migration bằng `drizzle.test.config.ts` trước khi chạy test. Database test sử dụng `tmpfs`, vì vậy dữ liệu sẽ mất khi container được xóa và tạo lại.

## Migration workflow

Sau khi thay đổi Drizzle schema, tạo migration mới tại thư mục API:

```powershell
cd D:\student-service\apps\api
npm exec -- drizzle-kit generate --config=drizzle.config.ts --name=ten-migration
```

Luôn review file SQL mới trong `apps/api/drizzle` trước khi chạy migrate.

## Build

```powershell
npm run build --workspace @student-service/api
npm run build --workspace @student-service/web
```

## Nguyên tắc bảo mật hiện tại

- Không lưu mật khẩu nguyên bản; chỉ lưu Argon2id hash.
- Không commit `.env`, connection string production, JWT secret hoặc khóa ký số.
- Role được lấy từ database, không tin role do frontend gửi lên.
- Backend phải kiểm tra quyền trên từng request.
- Cổng quản trị và cổng nghiệp vụ sẽ dùng chung hệ thống danh tính nhưng có session và chính sách bảo mật khác nhau.
- Chữ ký số là một bước xác thực tài liệu riêng, không đồng nhất với đăng nhập.

## Hướng phát triển

- Hoàn thiện đăng nhập và quản lý session.
- Phân quyền theo role, permission và phạm vi khoa/lớp.
- Cấu hình dịch vụ, biểu mẫu và quy trình duyệt.
- Kê khai hồ sơ, tài liệu minh chứng và xem trước văn bản.
- Chữ ký số theo từng bước trong workflow.
- Quản lý điểm rèn luyện, hoạt động ngoại khóa và nghiên cứu khoa học.
- Xuất Word, PDF và Excel theo nghiệp vụ.
