# Đóng Sprint 5 — Kê khai hồ sơ sinh viên

Ngày đóng: 14/10/2026. **CLOSED trong phạm vi kỹ thuật local**, theo yêu cầu chủ dự án “hoàn tất Sprint 5”. Codex kiểm chứng và ghi nhận hoàn tất theo ủy quyền này. Chưa có biên bản chủ dự án tự thao tác nghiệm thu riêng hoặc phê duyệt của Học viện. Production: **NOT_READY**. [Trạng thái JSON](sprint-5-status.json) ghi riêng Sprint 5; giữ nguyên hồ sơ đóng Sprint 2+3 và Sprint 4.

## Phạm vi

Kế hoạch hợp nhất của chủ dự án xác định Sprint 5 là **Student submission: tự điền hồ sơ, lưu nháp, upload và xem trước**. Căn cứ kỹ thuật: [ADR 0003](adr/0003-student-drafts-and-evidence.md), [hướng dẫn bản nháp](sprint-5-drafts.md). Giấy xác nhận sinh viên tiếp tục OFFLINE, làm việc trực tiếp tại Phòng CTSV.

Các increment gửi/tiếp nhận, bổ sung/duyệt, Word/PDF, chữ ký mô phỏng và phục hồi dữ liệu đã được phát triển nối tiếp; được giữ bằng chứng riêng. Xét duyệt và tài liệu thuộc Sprint 6, chữ ký thuộc Sprint 7, hardening/UAT thuộc mốc riêng. Việc đóng Sprint 5 không đóng các sprint này.

## Tiêu chí kiểm chứng

| Tiêu chí          | Bằng chứng yêu cầu                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Tự điền hồ sơ     | Họ tên, mã sinh viên, lớp, khoa lấy từ máy chủ; readonly; từ chối client ghi đè; kiểm tra quyền/hồ sơ hiện tại                           |
| Bản nháp          | Một nháp trên mỗi sinh viên/phiên bản; lưu thiếu thông tin; mở lại từ Thủ tục của tôi; phiên bản đã nghỉ chỉ xem                         |
| Dữ liệu đúng kiểu | TEXT, TEXTAREA, NUMBER, DATE, SELECT, BOOLEAN; giữ JSON 0/false/null; từ chối kiểu/lựa chọn/ngày không hợp lệ                            |
| Sửa đồng thời     | Revision bắt buộc; tab cũ nhận 409; giữ nội dung cục bộ, tải revision mới rồi lưu được                                                   |
| Minh chứng        | PDF/PNG/JPEG đúng cấu hình; giới hạn từng tệp/số lượng/tổng; byte gốc và SHA-256; kho riêng; tải qua phiên sở hữu; gỡ mềm                |
| Xem trước         | Thể hiện thông tin hiện tại, mục còn thiếu, thay đổi chưa lưu; focus vào phần xem lại; markup là văn bản                                 |
| Quyền và lỗi      | Guest/cán bộ không kê khai như sinh viên; hồ sơ/tệp của sinh viên khác không lộ; Origin được kiểm tra; thất bại không đổi revision/audit |
| Không tự gửi      | Xem lại/lưu nháp không gửi; chỉ gửi sau lưu đủ và xác nhận; kiểm tra thêm chốt snapshot của luồng đã có                                  |
| CTSV              | Không hiện nút kê khai và API từ chối nháp cho giấy xác nhận OFFLINE                                                                     |

## Thay đổi khi hoàn tất

- Thêm diễn tập một lần `npm run rehearse:sprint5 --workspace @student-service/api`, trình duyệt thật cùng API/PostgreSQL/kho đĩa thật, chỉ dùng dữ liệu giả. Mỗi lượt có database tmpfs mới, UUID và runtime/kho/bằng chứng trong project/run; kết thúc tự dừng máy chủ và xóa đúng container do lượt đó tạo.
- Profile riêng 127.0.0.9:3026/3027, không dùng database development 5433 hoặc test 5434; tách origin/cookie, state, khóa một lần; checker chỉ chạy qua launcher. Không dùng kết quả cũ làm lượt kiểm chứng mới.
- Sửa giới hạn tải tệp bị làm tròn thành 0,0 MiB: hiển thị chính xác theo MiB/KiB khi chia hết, hoặc số byte. Thêm kiểm tra trên giao diện thật cho 4 KiB/tệp và 8 KiB tổng. Không đổi giới hạn máy chủ.
- Sửa nhãn README để không gộp mọi increment vào Sprint 5.
- Giới hạn Web test trên Windows ở một worker, file tuần tự. Lượt song song timeout khởi tạo Nuxt: 23 bài đạt/99 chưa chạy; lượt tuần tự 119 đạt/3 chưa chạy do hook khởi tạo file đầu vượt 10 giây. Điều chỉnh riêng hook Nuxt trên Windows 10→30 giây; giữ nguyên thời hạn kiểm tra chức năng, không retry tự động hoặc bỏ qua test. Linux giữ mặc định. Log lỗi giữ riêng; kết quả đóng lấy lượt sau sửa.
- Hồi quy lần đầu phát hiện test cạnh tranh lease STAGED dùng lease 5 giây nhưng tính cả thời gian khởi động process/tsx Windows. Process thứ hai có thể đến sau hết lease và nhận FINAL hợp lệ. Test mới chờ cả hai worker READY trước khi claim; giữ lease 5 giây, chờ hết lease 5,2 giây sau process death, lỗi DOCUMENT_BUSY và các assertion fencing/byte gốc. Không đổi lease/deadline hoặc logic production. Log lần đầu được giữ riêng.

## Kết quả kiểm chứng tự động

Mã triển khai: `5dde68c1d63f0034eea531d97dbf454861d3d53e`, nhánh `feat/procedure-configuration`. Hồ sơ đóng được lưu trong commit tài liệu tiếp theo.

| Kiểm tra                                 | Kết quả                        | Log trong project/run                                                                       |
| ---------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| API unit nháp/minh chứng, có mục tiêu    | 6 đạt                          | sprint5-api-unit-20261014.log                                                               |
| API integration toàn dự án               | 306 đạt, 0 lỗi, 0 bỏ qua       | sprint5-api-integration-reviewed-20261014.log                                               |
| Web, bao gồm Nuxt acceptance             | 122 đạt trên 18 file, 0 bỏ qua | sprint5-web-tests-verified-20261014.log                                                     |
| ADR gate tests                           | 44 đạt                         | sprint5-adr-tests-20261014.log                                                              |
| Demo/profile/CLI guards                  | 20 đạt                         | sprint5-demo-guards-reviewed-20261014.log                                                   |
| Typecheck API, lint, format              | Đạt                            | sprint5-{typecheck,lint,format}-reviewed-20261014.log; sprint5-final-ui-format-20261014.log |
| Script format và kiểm tra ADR sau commit | Đạt                            | sprint5-script-format-reviewed-20261014.log; sprint5-final-adr-gate-20261014.log            |

Tổng các bộ trên: **498 bài đạt**, không cộng Nuxt acceptance thêm lần nữa. Sáu unit là bộ có mục tiêu, không gọi đó là toàn bộ API unit. Mốc API unit toàn dự án 181 đạt/1 skip Windows ở b13405e được giữ trong lịch sử, không cộng vào lượt này. Mẫu Word v1 giữ nguyên SHA-256 theo registry; lượt đóng này không sửa mẫu.

## Diễn tập trình duyệt cuối

Run `86bab7b5-f536-4f35-99a2-50b76c9b4645`: **PASS 12 nhóm, 16 lượt responsive, 0 lỗi JavaScript** trên browser/API/PostgreSQL/kho đĩa thật với dữ liệu giả. Bốn màn hình (nháp thiếu, nháp đủ, Thủ tục của tôi và hướng dẫn CTSV), mỗi màn hình ở 375/768/1024/1440 px; 8 ảnh desktop/mobile đã được xem trực tiếp, không thấy cắt chữ hoặc chồng lấn. Giới hạn hiển thị đúng 8 KiB tổng/4 KiB mỗi tệp; 0 và Không giữ nguyên.

Luồng thật gồm đăng nhập, tạo/lấy cùng nháp, tự điền bốn thông tin, lưu thiếu/xem mục thiếu, đủ sáu kiểu, preview chưa lưu/escape markup, hai tab 409 giữ nội dung, kiểm tra Origin/profile, từ chối tệp sai/quá lớn, tải PDF/PNG/JPEG và kiểm tra byte gốc, tải riêng theo owner, gỡ mềm/rồi tải lại, mở nháp từ danh sách. Kiểm tra thêm xác nhận gửi của luồng đã có: snapshot khóa, retry không nhân đôi; giấy xác nhận vẫn OFFLINE tại CTSV.

Bằng chứng local, bỏ qua trong Git: `run/workflow-demo/86bab7b5-f536-4f35-99a2-50b76c9b4645/browser-report.json`, `visual-review.json`, 8 PNG và `student-evidence.pdf`. Report SHA-256: `efc79ecd730a62dca28c4b565a27762aa496976fd5498eb212cb8d0f6f9ddf24`. Log launcher: `run/sprint5-browser-rehearsal-verified-20261014.log`. Trạng thái cuối **STOPPED**, container riêng đã được dọn; không báo cổng 3027 đang phục vụ người dùng.

Build API/Web đạt: `run/sprint5-build-20261014.log` và `run/sprint5-web-build-verified-20261014.log`. Lượt đầu run 0754654a-d396-41c2-9709-14f06284502d đã PASS luồng nhưng ảnh bộc lộ nhãn 0,0 MiB; được giữ làm chẩn đoán, không dùng thay lượt cuối sau sửa. Các log Web `reviewed`/`final` bị timeout trước sửa và integration đầu thất bại một ca con/ca cha cũng được giữ riêng. Kết quả đóng lấy đúng log đạt trong bảng trên.

## Cách lặp lại

Dùng Node 22 và Docker với image postgres:17-alpine đã có, build API/Web trước khi chạy diễn tập. Cài Playwright/Chromium sẵn và đặt WORKFLOW_PLAYWRIGHT_MODULE, WORKFLOW_CHROMIUM_EXECUTABLE nếu không có trong runtime mặc định. Không truyền DATABASE_URL, SUBMISSION_STORAGE_ROOT hoặc APP_ENV=production cho launcher. Không cần LibreOffice cho phạm vi này.

Launcher tạo dữ liệu giả Nguyễn Minh An/GIA240001, lớp/khoa giả, thủ tục giả riêng; giấy xác nhận vẫn trực tiếp CTSV. Không có gửi email bên ngoài hoặc dùng tài khoản thật. Cổng 3027 chỉ phục vụ lượt kiểm chứng và đã dừng khi hoàn tất; không coi đó là một bản triển khai cho người dùng.

## Giới hạn

Kho local và kiểm tra header tệp chưa thay cho kho bền vững, quét mã độc, retention hoặc backup được phục hồi trên thiết bị khác. Mọi tệp vẫn NOT_CHECKED; hash byte không chứng minh chữ ký/dấu đỏ có hiệu lực. Nghiệm thu vận hành bằng người dùng thực và phê duyệt của Học viện chưa được ghi nhận. Database development cũ không được khởi động, reset hoặc migrate trong lượt này.
