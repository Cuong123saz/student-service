# Kiểm tra truy cập đồng thời

Cập nhật 10/10/2026. Bổ sung bằng chứng cho [hàng đợi phân trang](review-queue-pagination.md) và [thông báo cá nhân](submission-handover-and-notifications.md), trên mã ứng dụng d01b4fc. Increment này thêm công cụ kiểm tra và tài liệu; không đổi nghiệp vụ, quyền, schema hoặc cấu hình development. Chưa nghiệm thu hay triển khai production.

## Chạy lại

Từ thư mục gốc, dùng Node 22.23.2 (repository yêu cầu >=22.19 và <23):

```sh
npm run test:concurrency --workspace @student-service/api
```

Cần PostgreSQL test đã migrate đến 0019, có các vai trò chuẩn STUDENT/FACULTY_REVIEWER/ADMIN và permission submission.review; cấu hình đầy đủ trong apps/api/.env.test, APP_ENV=test. Chỉ chấp nhận localhost hoặc 127.0.0.1, cổng 5434, database student_service_test. Không tự chạy migration/seed/reset database. Nếu thiếu vai trò chuẩn, thực hiện quy trình bootstrap test hiện có; không trỏ công cụ vào DB development.

Chạy độc quyền, sau khi các integration/browser test khác kết thúc. Công cụ từ chối chạy nếu submissions hoặc procedure_versions chưa trống, khóa advisory để ngăn hai bản của chính công cụ chạy cùng lúc. Năm kiểm thử chốt bảo vệ chạy trước build: từ chối DB development, host remote, tên database khác, APP_ENV=production và thiếu DATABASE_URL. Công cụ dùng máy chủ API con riêng trên cổng loopback được hệ điều hành cấp; không dùng hoặc dừng API:3000/Web:3001. Không cần trình duyệt, SMTP hay dịch vụ AI để thực hiện kịch bản.

## Kịch bản và cách đo

20 tài khoản cán bộ riêng, xen kẽ 10 phiên cổng user và 10 phiên cổng admin, có quyền review trên cùng vai trò/phạm vi đơn vị. Cookie JWT được cấp trước bằng secret ngẫu nhiên chỉ dùng trong bài thử; máy chủ vẫn xác thực cookie, audience, origin và quyền DB thật. Đây là phép đo sau đăng nhập, không đo xác thực mật khẩu, giới hạn đăng nhập hoặc luồng giao diện.

Seed 10000 dòng hồ sơ giả: 7000 chờ tiếp nhận trong phạm vi, 1000 đang xử lý phân đều 50 hồ sơ/cán bộ, 1000 chỉ định riêng cán bộ khác và 1000 thuộc đơn vị khác. 1000 thông báo có round/event và recipient hợp lệ được tạo cho nhóm đang xử lý. Dataset phục vụ truy vấn summary/thông báo: không phải 10000 hồ sơ đã trải qua đủ quy trình tải tệp, nộp, xử lý. Một hồ sơ riêng được tạo và gửi qua HTTP nghiệp vụ thật để thử tranh chấp nhận xử lý.

Làm ấm 20 tài khoản × 9 loại truy vấn, rồi lần lượt 1/5/10/20 worker. Mỗi worker là một tài khoản, gửi 45 yêu cầu liên tiếp; mỗi tài khoản chỉ có một yêu cầu đang chờ, không có thời gian nghỉ. Tổng 1620 yêu cầu đo, thêm 180 yêu cầu làm ấm và 85 yêu cầu kiểm tra nghiệp vụ/quyền: 1885 HTTP/lượt. Máy chủ API chạy trong process khác bộ tạo tải, dùng cấu hình pool hiện tại (mặc định postgres.js 10 kết nối), không tăng pool để làm đẹp số đo.

Chín loại: trang đầu, trang sâu sau mốc LOAD04000, tìm LOAD06999, tìm hồ sơ chỉ định bị ẩn, tìm hồ sơ ngoài đơn vị, tìm literal 50%_, nhóm Tôi đang xử lý, danh sách thông báo và số chưa đọc. Mỗi phản hồi đều kiểm tra HTTP và nội dung/quyền tương ứng. Trang sâu dùng cursor gắn từng người và đối chiếu 20 ID với SQL, giữ đủ 6 chữ số microsecond; không gọi tuần tự 200 trang trong bài thử này. Kiểm chứng đi hết 400 trang nằm ở increment trước.

Đo bằng performance.now từ trước fetch đến sau đọc JSON, gồm HTTP, xác thực, quyền DB, truy vấn và hàng chờ kết nối. Thống kê nearest-rank p50/p95/max theo pha và loại truy vấn. Đây là tải vòng kín ngắn: khi chậm, worker tự gửi ít hơn; không xác định sức tải tối đa, thời gian phản hồi theo tốc độ đến cố định hay độ ổn định dài hạn. Cache đã ấm, API/DB/bộ tạo tải cùng máy; máy còn chạy ứng dụng local, không phải máy benchmark độc quyền.

## Kết quả

Hai lượt độc lập, mỗi lượt tạo/dọn dataset mới. Điều kiện máy: Windows, Node v22.23.2, Intel(R) Xeon(R) W-10855M CPU @ 2.80GHz, 12 logical CPU, RAM 32 GiB. Thời điểm UTC: 2026-10-10T10:57:26.424Z và 2026-10-10T10:58:08.920Z. Không chạy các kiểm tra mã khác song song trong hai lượt đo.

| Phiên hoạt động | Yêu cầu đo/lượt | P50 ms (1 / 2) | P95 ms (1 / 2) | Yêu cầu/giây (1 / 2) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 45 | 30.38 / 33.84 | 47.75 / 47.80 | 31.69 / 30.51 |
| 5 | 225 | 41.11 / 41.56 | 75.87 / 77.55 | 104.96 / 109.08 |
| 10 | 450 | 65.04 / 64.44 | 110.57 / 112.92 | 135.46 / 138.20 |
| 20 | 900 | 149.41 / 154.92 | 207.90 / 289.31 | 131.37 / 118.39 |

Pha 20 phiên có 900 mẫu mỗi lượt, kéo dài 6.85 / 7.60 giây; phản hồi chậm nhất 247.80 / 397.99 ms. Đây là p95 gộp chín loại truy vấn, không phải p95 của mọi tính năng trong ứng dụng.

Cả hai lượt hoàn chỉnh đều đạt các kiểm tra nghiệp vụ:

- 20 người cùng nhận một hồ sơ: đúng 1 HTTP 200 và 19 HTTP 409 ALREADY_CLAIMED, trạng thái chuyển IN_REVIEW, revision tăng đúng 1.
- 20 yêu cầu gửi lại của người thắng: giữ nguyên revision và thời điểm nhận; đúng 1 event CLAIMED, 1 thông báo và 1 audit cho thao tác nhận.
- 20 yêu cầu đánh dấu cùng thông báo: cùng thời điểm đọc; gửi lại không đổi thời điểm, số chưa đọc giảm 50→49.
- 19 tài khoản khác đánh dấu thông báo riêng: tất cả 404. Thu hồi scope trong DB trong khi cookie còn hạn: hàng đợi 403, thông báo không còn trả hồ sơ đã mất quyền.
- Hồ sơ riêng/ngoài đơn vị bị ẩn; tìm literal, nhóm đang xử lý và trang sâu đúng; nội dung câu trả lời giả không xuất hiện trong summary/thông báo.

Mỗi lượt 1885 phản hồi: 1846 HTTP 200, 19 HTTP 409, 19 HTTP 404, 1 HTTP 403. Các 4xx đều là kết quả được yêu cầu trong kiểm tra tranh chấp/quyền; không có 5xx hay timeout. Năm kiểm thử chốt bảo vệ đạt. Build API, typecheck/lint, 99 API unit và kiểm tra định dạng đạt. Các kiểm thử hồi quy khác giữ bằng chứng 496 kiểm thử của increment trước; không chạy lại toàn bộ suite trong lượt này vì không đổi mã nghiệp vụ/UI.

## Đánh giá và giới hạn

Ở 20 phiên, p95 gộp là 207.90 / 289.31 ms. Riêng tìm LOAD06999 có p95 219.29 / 306.38 ms, cao hơn trang đầu 148.46 / 209.04 ms. Trong cả hai lượt, tăng 10→20 worker không làm thông lượng tăng tương ứng, trong khi độ trễ tăng. Đây là dấu hiệu cần điều tra tiếp, chưa xác định được nguyên nhân chỉ từ thời gian HTTP.

Không có căn cứ để tăng pool hoặc thêm agent rồi tuyên bố giải quyết quá tải. Tìm substring dùng ILIKE với nhiều trường là ứng viên cần đo sâu hơn; hàng chờ pool, tải PostgreSQL, CPU và nhiễu trên máy cũng có thể góp phần. Increment này giữ nguyên ứng dụng và cấu hình để có mốc so sánh.

Các số đo không đặt SLA và không phải bằng chứng đủ để mở hệ thống cho dữ liệu thật. Chưa thử tải duy trì nhiều giờ, mạng chậm, nhiều API instance, hàng trăm người hoạt động, ghi trên nhiều hồ sơ, file lớn, worker import/email, ký số hoặc tác vụ mô hình AI. Chia agent hỗ trợ phát triển không làm tăng sức tải của API/DB khi hệ thống vận hành.

Bước hiệu năng tiếp theo: thu thập kế hoạch truy vấn tìm kiếm và số đo CPU/DB/thời gian chờ kết nối trên môi trường thử ổn định, rồi mới chọn thay đổi chỉ mục hoặc pool. Mọi thay đổi schema phải theo cổng ADR hiện có và có số đo trước/sau với cùng workload. Chuẩn bị backup/restore và lưu trữ tệp vẫn là yêu cầu vận hành riêng theo ADR0003.

## Dọn dữ liệu và bằng chứng

Sau khi máy chủ con dừng, công cụ khóa các bảng hồ sơ, kiểm tra toàn bộ submissions/procedure_versions thuộc thủ tục giả của lượt chạy rồi dọn trong một transaction; phát hiện dữ liệu thủ tục khác thì từ chối TRUNCATE. Tài khoản/role/scope/thủ tục/đơn vị giả được dọn, kiểm tra lại không còn hồ sơ, version hoặc tài khoản theo prefix. Không tắt trigger bất biến. 3 audit giả/lượt được giữ theo chính sách append-only; audit tồn tại trước đó được giữ. Không thay dữ liệu, quyền hoặc cấu hình DB development, giấy xác nhận sinh viên tiếp tục OFFLINE tại CTSV.

Báo cáo PASS chỉ ghi sau khi kiểm tra nghiệp vụ và dọn dữ liệu thành công. Báo cáo cũ được bỏ trước khi bắt đầu seed, tránh dùng nhầm kết quả cũ sau lỗi. Nếu process bị kết thúc đột ngột, dữ liệu thử có thể còn lại; lần chạy sau sẽ từ chối DB không trống, không tự reset để che lỗi. Advisory lock không thay cho việc chạy độc quyền với các test khác không dùng cùng khóa.

Công cụ có trong repository: apps/api/scripts/check-concurrency.mjs, check-concurrency.test.mjs và npm script test:concurrency. Bằng chứng local (git ignore): run/concurrency-check-first.log, run/concurrency-check-second.log, run/concurrency-report-first.json, run/concurrency-report.json, run/concurrency-api.log và run/concurrency-*.log của các kiểm tra mã. Báo cáo JSON có điều kiện máy, số request/status, số đo từng endpoint, kiểm tra tranh chấp và cleanupVerified.
