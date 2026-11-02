# Quy ước phát triển cho các sprint tiếp theo

Review ngày 23/10/2026 trên nền commit `11be64f` và các thay đổi cục bộ hiện có. Đây là quy ước phát triển, không phải hồ sơ đóng sprint hoặc xác nhận production-ready.

## Các điểm đã chỉnh

| Vấn đề                                               | Hệ quả khi mở rộng                                                                                       | Cách xử lý                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Service training tự tạo repository và kho tệp        | Import service kéo theo cấu hình/database; khó viết unit test và thay adapter                            | Khởi tạo tại `apps/api/src/app.ts`, truyền repository/storage vào constructor; tham chiếu repository trong service chỉ là type      |
| Hai luồng kiểm tra minh chứng lặp logic              | Sửa một luồng nhưng để sót luồng còn lại; lỗi mất tệp của sinh viên chưa được chuyển thành lỗi nghiệp vụ | Dùng `apps/api/src/lib/verified-evidence.ts`; giữ mã lỗi theo module và kiểm quyền trước/sau I/O                                    |
| Bộ chạy test tìm chuỗi `buildApp`/`db/client`        | Comment có thể phân loại sai; dependency qua helper có thể bị bỏ sót                                     | Phân tích import thực và duyệt dependency gián tiếp; bỏ qua import type; lỗi import nội bộ không phân giải được phải dừng discovery |
| Acceptance web bị chạy hai lần trong lệnh test chung | Tăng thời gian CI và tạo kết quả đếm trùng                                                               | `npm run test:web` chạy toàn bộ project Vitest một lần; vẫn có lệnh unit/acceptance riêng                                           |

Nuxt acceptance test dùng build directory riêng `apps/web/node_modules/.cache/nuxt-vitest` để không ghi đè manifest của bản dựng ứng dụng. Lượt kiểm tra ban đầu từng gặp lỗi `#app-manifest` khi build/test ghi chung thư mục; chạy tuần tự đã đạt trước khi cấu hình tách thư mục.

## Khi thêm hoặc sửa một module

1. Đọc README, kế hoạch sprint và ADR liên quan trước khi sửa nghiệp vụ. Không sửa hồi tố migration đã áp dụng; thêm migration mới cùng kiểm thử nâng cấp/bảo toàn dữ liệu. Thay đổi schema chịu ADR gate hiện có.
2. Route chịu trách nhiệm hợp đồng HTTP, session/Origin và kiểm tra đầu vào. Repository giữ truy vấn, khóa, quyền hiện tại và transaction. Service điều phối nghiệp vụ/I/O; không tự tạo database client hoặc đọc cấu hình toàn cục. Khởi tạo adapter tại `app.ts` như các service training và submissions. ESLint chặn import runtime repository/database/cấu hình và local storage adapter trong các service training; import repository chỉ dùng làm type được phép.
3. Với module đang có, dùng hợp đồng `Pick<Repository, ...>` để giới hạn public methods cần thiết, không kéo private state của class vào fake. Khi tách module hoặc thêm adapter thứ hai, chuyển sang interface/DTO độc lập khi có yêu cầu cụ thể; không thêm lớp trung gian rỗng chỉ để đủ tầng.
4. Giữ transaction ngắn; không đọc đĩa, gửi mail hoặc chạy converter trong transaction đang giữ khóa. Với dữ liệu riêng tư phải kiểm quyền trước/sau I/O; với snapshot minh chứng phải kiểm cả hash, size và binding. Không biến lỗi 403/404 thành lỗi kho tệp.
5. Nghiệp vụ thay đổi dữ liệu cần kiểm thử revision, idempotency, tranh chấp và rollback audit khi có liên quan. Unit test dùng fake qua dependency injection; các test đi qua database/`buildApp` cần kiểm thử tích hợp trên database test riêng.
6. Giữ các thành phần dùng chung độc lập với feature: helper đọc tệp nhận callback và trả kết quả/lý do lỗi, module quyết định mã lỗi HTTP. Không để helper tự mở database hoặc quyết định quyền nghiệp vụ.

## Chạy kiểm tra

Dùng Node theo `.nvmrc` (`22.23.2`); `engines` và `.npmrc` đã chặn phiên bản không phù hợp.

- `npm run check`: kiểm tra kiểu API và Nuxt web.
- `npm run lint` và `npm run format:check`: kiểm tra chất lượng hiện có. Lint hiện chỉ áp dụng API; không coi đó là bằng chứng lint web.
- `npm run test:unit --workspace @student-service/api`: kiểm thử discovery, rồi unit test API; không cần `.env.test` hoặc database. Một số kiểm thử supervisor cần môi trường hệ điều hành/converter phù hợp.
- `npm run test:web`: chạy unit và acceptance web mỗi project một lần. Chạy riêng bằng `npm run test:unit --workspace @student-service/web` hoặc `npm run test:acceptance --workspace @student-service/web`.
- `npm run test:integration --workspace @student-service/api`: chỉ chạy khi PostgreSQL test theo `docker-compose.test.yml` và `.env.test` đã sẵn sàng. Không thay URL bằng database development/production để vượt lỗi kết nối.
- `npm run build`: kiểm tra bản dựng API/web trước khi bàn giao thay đổi runtime.

Discovery chỉ theo các import nội bộ có đường dẫn tĩnh, bao gồm import/export thông thường, `import('...')` và `require('...')`. Không suy ra được đường dẫn tính toán tại runtime; tránh dùng kiểu import đó cho dependency môi trường trong kiểm thử. Test dùng dịch vụ bên ngoài khác cần khai báo và quản lý môi trường riêng khi chức năng đó được thêm.

## Những ràng buộc cần giữ khi làm sprint sau

- Sprint 10 xuất bảng/biên bản cần dùng kết quả và snapshot đã duyệt, giữ nguyên bản tự kê khai và lịch sử. Không thêm một đường truy vấn export bỏ qua quyền/phạm vi hiện tại.
- Các port training hiện còn suy kiểu từ repository; đây là bước tách dependency runtime, chưa phải cam kết API ổn định giữa các hệ thống độc lập.
- Các route training vẫn dùng lại HTTP/error/storage của submissions. Chỉ tách thành hạ tầng dùng chung khi một thay đổi cụ thể yêu cầu; khi tách phải giữ hợp đồng lỗi/session và kiểm thử hồi quy của cả hai luồng.
- Chưa có kiểm chứng tích hợp khi PostgreSQL test không chạy. Unit test đạt không thay thế kiểm thử SQL, trigger, migration hoặc truy cập đồng thời.
- Lượt review này không thay roadmap, đóng sprint, triển khai production hoặc nâng schema database đang dùng.
