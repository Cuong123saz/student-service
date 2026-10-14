# Đóng Sprint 4 — Cấu hình thủ tục

Ngày đóng: 14/10/2026. Trạng thái **CLOSED trong phạm vi kỹ thuật local**, theo yêu cầu chủ dự án “tự haonf thành tới khi xong sprint 4”. Codex kiểm chứng và ghi nhận hoàn tất theo ủy quyền này. Chưa có biên bản chủ dự án tự thao tác nghiệm thu riêng; không ghi chữ ký của chủ dự án hoặc phê duyệt của Học viện. Production: **NOT_READY**.

## Phạm vi và căn cứ

[Kế hoạch Sprint 4](sprint-4-plan.md) và bản kế hoạch Word của chủ dự án cùng xác định Sprint 4 là Procedure configuration: biểu mẫu động, attachment config, nơi xử lý/workflow và phiên bản. Giấy xác nhận sinh viên tiếp tục OFFLINE tại Phòng CTSV; giữ ADR0001/0002.

Kê khai thuộc Sprint5; xét hồ sơ và Word/PDF thuộc Sprint6; ký mô phỏng/verify/audit theo workflow thuộc Sprint7; hardening/UAT thuộc Sprint13. Yêu cầu kiểm chứng Word/PDF và mock signer trong mục tiêu tiếp tục được theo dõi riêng trong [tiến độ](implementation-progress.md); không dùng chúng thay bằng chứng cấu hình.

Mã triển khai đã kiểm thử: `e847ee04e83bb43f72de9c718b05f266ddc7b62f`, nhánh `feat/procedure-configuration`. Hồ sơ đóng nằm trong commit tài liệu sau commit này. [Trạng thái JSON](sprint-4-status.json) ghi riêng Sprint4; `sprint-status.json` giữ nguyên bằng chứng lịch sử Sprint2+3.

## Đối chiếu tiêu chí

| Tiêu chí                                                                 | Bằng chứng đạt                                                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Nháp mặc định OFFLINE, chưa public                                       | Trình duyệt tạo nháp thật; API public trả null trước publish                                                   |
| Sáu kiểu TEXT/TEXTAREA/NUMBER/DATE/SELECT/BOOLEAN, nguồn hồ sơ allowlist | Lưu đủ kiểu và hai trường nguồn hồ sơ; unit/integration kiểm tra schema                                        |
| Yêu cầu minh chứng                                                       | Lưu MIME PDF/PNG và số lượng; từ chối cấu hình sai; upload thuộc increment khác                                |
| Xem trước, kiểm tra và sửa lỗi                                           | Markup được escape; cấu hình sai bị từ chối rồi sửa và lưu được                                                |
| Đơn vị/cán bộ hợp lệ                                                     | ONLINE cần reviewer ACTIVE đúng scope; owner không đổi tuyến sang đơn vị khác; OFFLINE không bắt buộc reviewer |
| Cập nhật đồng thời                                                       | Conflict409 giữ nội dung chưa lưu ở tab cũ                                                                     |
| Phiên bản bất biến                                                       | Publish v1 khóa sửa; clone/publish v2 và retire v1 nguyên tử; nội dung v1 nguyên vẹn                           |
| Phân quyền và public                                                     | GLOBAL khởi tạo, ORGANIZATION duy trì thuộc đơn vị; ngoài scope bị chặn; guest/student không dùng API quản trị |
| Public đúng bản áp dụng                                                  | PUBLISHED/ACTIVE; không lộ processorUserId/ownerUnitId; OFFLINE đọc không cần đăng nhập                        |
| Lịch sử/audit nguyên tử                                                  | 9 event đúng actor/hash; lỗi400/403/409 không sinh success audit; integration thử rollback audit               |
| CTSV                                                                     | STUDENT_CONFIRMATION OFFLINE, hướng dẫn đến Phòng CTSV                                                         |
| Hồi quy/giao diện                                                        | Các kết quả dưới đây; 16 responsive không tràn ngang, 0 lỗiJavaScript                                          |

## Kiểm thử ngày 13/10/2026

Node22.23.2, PostgreSQL17, Chromium; dữ liệu diễn tập giả. Các tập sau không trùng nhau:

| Tập                 |     Đạt | Bỏ qua | Log trong project                          |
| ------------------- | ------: | -----: | ------------------------------------------ |
| API unit            |     160 |      1 | `run/sprint4-api-unit-20261013.log`        |
| API integration     |     306 |      0 | `run/sprint4-api-integration-20261013.log` |
| Web, gồm acceptance |     122 |      0 | `run/sprint4-web-tests-20261013.log`       |
| Rào chắn ADR        |      44 |      0 | `run/sprint4-adr-tests-20261013.log`       |
| Rào chắn demo       |      15 |      0 | `run/sprint4-demo-guards-20261013.log`     |
| Tổng                | **647** |  **1** | Không cộng lại acceptance vào Web          |

Không có bài thất bại. Bài bỏ qua `private file never follows a file symlink`: Windows không cho tạo symlink trong test. Typecheck/lint/format/API-Web build đạt; log tương ứng `run/sprint4-typecheck-20261013.log`, `run/sprint4-lint-20261013.log`, `run/sprint4-format-20261013.log`, `run/sprint4-build-api-20261013.log`, `run/sprint4-build-web-20261013.log`.

Trình duyệt thật run `32ecf09e-c140-42ca-a71f-2f1b5d63bd33`, profile sprint4: `run/workflow-demo/32ecf09e-c140-42ca-a71f-2f1b5d63bd33/browser-report.json` đạt10 nhóm,16 kiểm tra ở375/768/1024/1440px,0 lỗiJavaScript. Đã xem cả8 ảnh mobile/desktop của cấu hìnhv1, publicOFFLINE, cấu hìnhv2 và giấy xác nhậnCTSV. Không thay API/PostgreSQL bằng mock response.

Audit: tạo nháp2, sửa4, áp dụng2, retire1. Cuối lượt v1 RETIRED/revision5, v2 PUBLISHED/revision3. Report SHA-256 pin trong JSON. Log/ảnh và dữ liệu giả giữ trong `run/`, Git bỏ qua; chưa phải bằng chứng độc lập được công bố.

## Chạy lại

Dùng Node22, Docker Desktop, Playwright/Chromium đã cài, tại thư mục project:

```powershell
npm run build
npm run rehearse:sprint4 --workspace @student-service/api
```

Có thể chỉ định WORKFLOW_PLAYWRIGHT_MODULE/WORKFLOW_CHROMIUM_EXECUTABLE khi runtime trình duyệt được quản lý riêng. Mỗi lượt có database tmpfs/runtime/runID mới; checker riêng chỉ chạy từ parent qua IPC, không dùng lại lượt đã kiểm tra. Tự dừng API/Web và xóa đúng container của lượt, giữ báo cáo/ảnh trong project. Cổng `.7:3022/3023` phải trống.

## Môi trường và giới hạn

Lượt Sprint4 STOPPED, container đã xóa. Test5434 đã trả về dừng; development5433 vẫn exited, không migrate/reset. Kiểm tra chỉ đọc demo `.6:3021/login` và API `.6:3020/services` trả200; không chạy lại checker hoặc thay dữ liệu demo. Xem `run/sprint4-environment-20261013.json`.

Đóng Sprint4 khẳng định phạm vi cấu hình đạt ở local. Chưa triển khai production, xác nhận hiệu lực chữ ký/thẩm quyền ký/mẫu chính thức hoặc nghiệm thu dữ liệu thật. Không dùng hash hoặc duyệt nội dung làm chữ ký số hợp lệ.
