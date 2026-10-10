# Hiệu năng tìm kiếm hàng đợi

Cập nhật 10/10/2026. Theo [ADR 0008](adr/0008-review-search-index.md), thiết kế commit 043689b trước migration 0020, bổ sung quyết định cập nhật trực tiếp commit 4c9e1fc trước 0021. Giữ nguyên hợp đồng tìm kiếm, bộ lọc, cursor, quyền hiện tại và thứ tự của [ADR0007](adr/0007-review-queue-pagination.md). Giấy xác nhận sinh viên vẫn OFFLINE tại CTSV. Chưa production hoặc đóng sprint.

## Thay đổi

Migration 0020 cài pg_trgm nếu chưa có và thêm một GIN nhiều cột trên fullName/studentCode của student_snapshot và service_name. Không thêm cột hoặc tìm trong câu trả lời, lý do, minh chứng. Query OR ILIKE, escape ký tự literal %, _, gạch chéo ngược, dấu tiếng Việt và phân trang giữ nguyên. Planner tự lựa chọn GIN hoặc btree/scan theo từ khóa; không ép bỏ scan hay cắt kết quả để làm nhanh.

Thí nghiệm sau bulk insert phát hiện 83 trang cập nhật chờ của GIN mặc định: tìm mã vẫn scan 16.03 ms. Sau dọn riêng pending list, cùng SQL dùng GIN và còn 0.586 ms. Migration 0021 đặt fastupdate=off và xử lý pending hiện có một lần. Hồ sơ mới cập nhật index trực tiếp, ưu tiên độ ổn định đọc, đổi lại tốn công ghi hơn. Migration 0020 đã áp dụng test nên được giữ nguyên; không sửa lịch sử migration. Btree 0019 phục vụ thứ tự vẫn giữ.

Theo [PostgreSQL 17](https://www.postgresql.org/docs/17/gin.html#GIN-FAST-UPDATE), pending list có thể làm chậm đọc và fastupdate có thể tắt khi ưu tiên phản hồi ổn định. Không thay pool 10, autovacuum hoặc cấu hình PostgreSQL toàn hệ thống. Môi trường thật cần đo write/storage, quyền cài extension và thời gian khóa ghi khi tạo GIN; không lấy thời gian local làm cam kết vận hành. Nếu cần quay lui, tạo migration bỏ riêng index; không tự gỡ extension được đối tượng khác dùng.

## Chạy lại và cách đo

Dùng Node 22, DB test localhost:5434/student_service_test, APP_ENV=test đã migrate đến 0021 và có vai trò chuẩn. Chạy độc quyền khi các integration/browser test khác đã kết thúc:

```sh
npm run test:search-profile --workspace @student-service/api
```

Kế thừa chốt bảo vệ và dọn dữ liệu của [bài thử đồng thời](concurrent-access-check.md): 20 tài khoản, 10000 hồ sơ giả, 1000 thông báo, 1/5/10/20 phiên, 1885 HTTP/lượt. Các lượt đo đều được làm ấm, chạy API con riêng và giữ nguyên dataset/pool/workload. Dataset summary không đại diện cho 10000 hồ sơ đủ file/lịch sử. Các lần đo không chạy cùng kiểm tra mã khác.

Profiler đọc repository thật qua DB riêng với pool 10: logger thu chính xác authority + page SQL, chạy EXPLAIN ANALYZE/BUFFERS trên page SQL và tham số đó; hash SQL trước/sau được đối chiếu. Thêm 25/250/500 lời gọi repository ở 1/10/20 worker để đo thời gian từ bắt đầu begin đến callback, thời gian trong callback và tổng giao dịch. Thời gian chờ bao gồm cấp kết nối và BEGIN/network, không phải pool wait thuần; CPU chỉ là process Node của profiler, không phải CPU PostgreSQL hay toàn máy. Đây là phép đo bổ trợ, không thay thế HTTP.

Mặc định profiler chỉ đọc, không VACUUM hoặc dọn index trước khi đo. Tùy chọn --clean-pending-experiment chỉ phục vụ thí nghiệm rõ ràng trong DB test; kết quả nếu dùng được tách trong JSON. Phiên bản final đo fastupdate=off không cần bảo trì giữa seed và truy vấn. Cả hai pha vẫn giữ kết quả tranh chấp, retry và quyền; JSON chỉ PASS sau khi dọn dữ liệu thành công. Audit giả được giữ theo append-only.

## Kết quả thực thi

Mốc trước chỉ mục và hai lượt final tạo dataset mới độc lập, cùng Windows/Node 22.23.2, Xeon W-10855M, 12 logical CPU, 32 GiB RAM. Thời điểm UTC: 2026-10-10T12:10:53.402Z (trước), 2026-10-10T12:19:29.702Z và 2026-10-10T12:26:46.873Z (final). Lượt final đầu helper có gọi dọn pending nhưng trả 0 trang; lượt đối chiếu dùng helper chỉ đọc mặc định, không gọi dọn pending. Cả hai cho kế hoạch GIN và kết quả đúng.

| Page SQL thật | Trước (ms) | Final 1 (ms) | Final 2 (ms) |
| --- | ---: | ---: | ---: |
| first | 0.215 | 0.224 | 0.293 |
| rare | 18.667 | 0.946 | 0.919 |
| private-empty | 16.535 | 0.795 | 0.747 |
| literal | 18.448 | 0.717 | 0.573 |
| short-common | 0.184 | 0.257 | 0.208 |

Tìm mã trước scan loại 9999 dòng, 851 shared hits; final dùng BitmapOr/GIN rồi recheck predicate và quyền. Thời gian SQL ở bảng là một EXPLAIN mẫu sau làm ấm, không phải trung vị nhiều lượt và không phải thời gian HTTP.

| HTTP ở 20 phiên, 900 mẫu/lượt | Trước | Final 1 | Final 2 |
| --- | ---: | ---: | ---: |
| P50 (ms) | 116.52 | 63.02 | 70.11 |
| P95 (ms) | 159.44 | 97.64 | 102.75 |
| Yêu cầu/giây | 168.19 | 297.71 | 268.97 |
| Chậm nhất (ms) | 184.38 | 156.75 | 163.57 |

P95 thời gian đến callback giao dịch ở 20 repository worker: 129.18ms trước → 41.95/38.81ms final. GIN ở dataset 10.000 dòng có dung lượng 1327104/1327104 byte; các btree/heap không nằm trong số này.

Chi phí ghi quan sát được: lượt final2 INSERT bulk 10.000 submissions và cập nhật index mất 3268.14ms; đây là một câu lệnh bulk, không tương đương 10.000 hồ sơ được gửi qua HTTP và không có baseline INSERT đo cùng điều kiện để kết luận phần chi phí tăng. P95 cuộc đua 20 người nhận cùng hồ sơ: 578.16ms trước, 288.25/308.35ms final. Chỉ một người thắng,20 retry vẫn đúng 1 event/notification/audit. Không dùng bài tranh chấp này để suy ra throughput ghi nhiều hồ sơ.

Mỗi lượt 1885 HTTP, 1846 thành công, 19 xung đột nhận hồ sơ409, 19 truy cập thông báo người khác404 và 1 phản hồi403 sau thu hồi scope. Các 4xx là kết quả kiểm tra yêu cầu; không có 5xx hoặc timeout. 20 yêu cầu đánh dấu cùng thông báo giữ một thời điểm đọc. Hồ sơ chỉ định/ngoài đơn vị bị ẩn, trang sâu/literal/mine đúng.

## Kiểm chứng và vận hành local

Đã đạt 99 API unit, 260 API integration, 34 kiểm thử cổng ADR và 5 kiểm thử chốt môi trường; build API, typecheck/lint, định dạng và diff check đạt. Kiểm thử migration áp dụng 0017→0021 trên DB tạm, giữ nguyên rows, có đúng index 3 gin_trgm_ops, pg_trgm và fastupdate=off. Kiểm thử mới bao phủ đi hết 67 hồ sơ qua từ khóa 1/2 ký tự, có dấu/không dấu và từ khớp nhiều kết quả; các kiểm thử quyền/literal/cursor hiện có vẫn đạt. Sau sửa kiểu SQL/optional field, hai kiểm thử mới đã chạy lại riêng và đạt. Web không đổi, giữ bằng chứng 105 kiểm thử của increment trước, không chạy lại trong đợt này.

Đã áp dụng đúng 0020–0021 trên DB development localhost:5433/student_service sau kiểm tra hash 0019 và đúng hai migration pending. Đối chiếu users/submissions/files/rounds/events/notifications/permissions/grants và cấu hình STUDENT_CONFIRMATION giữ nguyên; GIN 3 cột/extension/fastupdate=off và btree cũ đều có. API:3000/Web:3001 tiếp tục hoạt động; trang public/Web 200, hàng đợi hai cổng và thông báo 401 khi chưa đăng nhập. Không cần đổi hợp đồng hoặc khởi động lại ứng dụng để PostgreSQL sử dụng chỉ mục mới.

Chỉ mục giúp trường hợp tìm kiếm cụ thể; từ khóa ngắn/rộng hoặc chỉ ký hiệu có thể không được lợi. Không đổi ý nghĩa tìm kiếm để che giới hạn. Các lượt HTTP chỉ kéo dài vài giây với cache ấm, tải vòng kín và máy dùng chung; chưa xác định số người tối đa, tải duy trì, nhiều API instance, worker/file/AI hoặc SLA production. Thao tác nhận hồ sơ đúng dưới tranh chấp không thay thế benchmark thông lượng ghi trên nhiều hồ sơ.

Bằng chứng local (git ignore): run/search-baseline.{log,json}, run/search-after.{log,json} (GIN mặc định), run/search-pending-experiment.{log,json}, run/search-final.{log,json}, run/search-final-repeat.{log,json}, run/search-api-tests.log, run/search-{typecheck,lint,format-check,adr-tests,concurrency-guards}.log, run/search-dev-migration.log và run/search-local-health.log. Snapshot SQL/profile đầy đủ nằm trong các JSON; log chỉ in tóm tắt.
