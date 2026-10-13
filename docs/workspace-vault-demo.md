# Demo vault trong project

Cập nhật13/10/2026. Demo mới: http://127.0.0.6:3021/login, API3020. Tài khoản giả demo.sinhvien (sinh viên), demo.canbo (cán bộ), mật khẩu chung DemoSinhVien#2026!. Dùng DEMO3 để tự thực hành; DEMO1/2 đã dùng cho checker. Giấy xác nhận sinh viên vẫn làm trực tiếp tại Phòng CTSV.

Theo [ADR0012](adr/0012-synthetic-artifacts-in-workspace.md), mọi kho của demo vault tạo mới nằm dưới run/workflow-demo/UUID/vault trong project và bị Git bỏ qua. Các kho cũ không bị di chuyển hoặc ghi đè; source development giữ nguyên. CLI `npm run demo:workspace-vault --workspace @student-service/api`; checker chỉ chạy một lần bằng demo:workspace-vault:check. Cần Node22/Windows/Docker/LibreOffice tuyệt đối và runtime API/web đã build như demo vault trước.

## Kết quả

Run `01233f70-2ae4-4da1-a705-b490d298cfb3` PASS:19 nhóm kiểm tra nghiệp vụ,24 phép kiểm tra responsive375/768/1024/1440, không lỗi JavaScript. Hồ sơ997434cc-f365-48a5-80f0-a735974f1795 duyệt sau hai round;770fc1e5-a628-49ad-8d1b-5ac8b426e88c từ chối. Word/PDF/ZIP owner/reviewer/admin/lịch sử giữ byte; mẫu gắn round bất biến,0/false và15/true giữ đúng type, status READY đọc lại không thêm attempts, quyền/portal/scope được kiểm tra, chữ ký không tự kết luận hợp lệ. DEMO3 trống tại cuối checker và lúc đối chiếu.

Đối chiếu database và kho của hồ sơ kiểm thử:4 document+4 stage,4 job COMPLETE/attempts1/allowance0; SHA/size tệp khớp, PDF giữ sourceDocxSha256/renderer của Word. Đã xem toàn bộ2 trang Word và2 trang PDF thực; mỗi tài liệu một trang, tiếng Việt/10 trường/footer chưa ký đúng. Pypdf strict/text/type checks đạt.

Bằng chứng nằm trong run/workflow-demo/UUID: browser-report.json, verified-inventory.json, verified-pdf-layout.json, các bản tải và ảnh UI. Render QA tại run/document-qa/workspace-vault-01233f70.14 demo guard,8 guard backup/upgrade,6 provenance đạt; typecheck/lint/build API đạt. Không chạy lại toàn bộ306 integration vì không đổi schema/route ứng dụng trong mốc này.

## Giới hạn đã quan sát

Lượt be137159-4c72-4a84-9adf-ae59b5816d94 dừng ở VERSION trước mở API:10 giây không đủ, report TIMEOUT/CANCELLED/empty=true, tổng12,334 giây gồm dừng process. Probe10 giây tiếp theo có mẫu đầu TIMEOUT/nativeEXITED/empty=true ở10,129 giây, hai mẫu sau6,5–6,8 giây đạt. Đã tăng riêng Windows VERSION lên15 giây; giữ PDF90 giây, output4KiB, reaping/quarantine, lease180 giây. Test version giả trả sau11 giây đạt và xác nhận process đã hết; probe15 giây3/3 đạt khoảng6,3–6,5 giây. Không coi probe này là cold boot máy, hoặc kết luận nguyên nhân lỗi PDF đầu ngày12/10 đã được chứng minh. Xem [supervisor](document-process-supervisor.md).

Docker/tmpfs vẫn là dữ liệu thử tạm, chưa có cam kết giữ database qua tắt Docker. Không start/reset container cũ12d8; giữ kho/metadata để đối soát. Demo mới không thay UAT, B3, backup ngoài thiết bị hoặc ký/phát hành chính thức. Development upgrade vẫn bị guard chặn vì một bản ghi migration cũ chưa xác minh; xem [bản sao development](offline-development-preservation.md).
