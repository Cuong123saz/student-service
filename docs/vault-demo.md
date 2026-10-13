# Demo lưu và tải lại Word PDF

> Bản thực hành mới ngày13/10 nằm trong project tại [demo workspace](workspace-vault-demo.md), http://127.0.0.6:3021/login. Bản12d8 dưới đây đã dừng database khi Docker tắt; kho được giữ, không reset.

Cập nhật 12/10/2026. Chỉ dùng dữ liệu giả. Bản demo mới chạy ở http://127.0.0.4:3017/login, API3016, tách origin/cookie/cổng và cơ sở dữ liệu khỏi các demo3011/3013/3015 và development5433. Phiếu là bản kê khai chưa ký, không phải giấy xác nhận được phát hành.

## Vận hành

Dùng Node22, Docker Desktop đang chạy và LibreOffice Windows có đường dẫn tuyệt đối trong LIBREOFFICE_PATH. Dựng API và web trước, rồi chạy npm run demo:vault --workspace @student-service/api. Không truyền DATABASE_URL, SUBMISSION_STORAGE_ROOT hoặc APP_ENV vào launcher. Cổng đang dùng thì từ chối trước tạo database, không tự dừng demo hiện có.

Launcher tạo container PostgreSQL17 tmpfs có tên/label/UUID riêng, migrate và seed dữ liệu giả trong database đó. Sao chép bản compiled API gồm script giám sát PowerShell và web build vào runtime của lần chạy. Sao chép mẫu v1, metadata và launcher riêng. Kho trên D:/student-service-vault-demo-<UUID> có documents, staging, templates tách nhau và tách khỏi source/evidence. Dependency fflate đang cài được hash; nếu nó thay đổi, provenance từ chối tạo mới. Không coi đây là bản đóng gói độc lập hoàn toàn khỏi node_modules.

API có kho chỉ khởi động bằng child riêng đã kiểm tra IPC với parent, UUID, entry path, môi trường test, database loopback/cổng riêng, evidence/fake.env đúng root và origin cố định. Trước khi mở HTTP, kiểm tra phiên bản converter, tạo thử Word/PDF bằng dữ liệu giả đủ sáu kiểu trường/0/false, rồi kiểm tra lại phiên bản. Không tạo hồ sơ hay job trong DB từ phép kiểm tra sẵn sàng. Kiểm tra thất bại thì demo không được báo READY. Log lỗi provenance chỉ có mã hữu hạn, không đưa đường dẫn/driver log vào HTTP.

Các tài khoản demo.sinhvien, demo.svkhac, demo.canbo, demo.ngoai dùng mật khẩu giả DemoSinhVien#2026!. DEMO1/2 phục vụ kiểm tra tự động; DEMO3 để người dùng thực hành. Giấy xác nhận sinh viên vẫn trực tiếp tại CTSV. Quyền document.retry không tự cấp thêm cho ADMIN trong demo; luồng mở thêm lượt trên giao diện với backend thật đã đạt trong [profile retry riêng](retry-browser-rehearsal.md), không đổi quyền hoặc dữ liệu demo này.

Database tmpfs của demo không dùng để lưu dữ liệu thật hoặc làm bản lưu lâu dài. Dừng launcher sẽ xóa đúng container của nó; kho/báo cáo trên D được giữ. Trước khi dừng một demo có dữ liệu người dùng tự thực hành, phải bảo toàn dữ liệu cần giữ. Không chạy lại checker trên demo đã có báo cáo hoặc claim. Hai checker cạnh tranh chỉ một được lấy marker wx; checker còn lại dừng trước mở trình duyệt/thao tác hồ sơ.

## Kiểm chứng

Lượt `12d8bed0-c37b-4ced-b1bc-3559550c1a3c` PASS trên Chromium và backend thật: một hồ sơ duyệt sau hai round, một hồ sơ từ chối,19 kiểm tra nghiệp vụ, không lỗi JS, 24 phép kiểm tra bố cục ở375/768/1024/1440px không tràn ngang. DEMO3 chưa có hồ sơ. UI hiển thị Word/PDF Đã lưu thành công, attempts1/3; tải lại qua owner/reviewer/admin và lịch sử vẫn đúng byte.

Đối chiếu trực tiếp DB và kho đạt:4 document +4 stage,4 job COMPLETE, mỗi job attempts1/allowance0; PDF trỏ đúng hash Word và giữ renderer của Word. Cả hai Word render bằng render_docx.py và cả hai PDF thật đã xem toàn bộ trang; mỗi bản một trang, đủ10 trường/sáu kiểu,0/15,Không/Có, tiếng Việt và footer chưa ký rõ. pypdf strict/text checks đạt. Ảnh UI desktop và mobile đã xem. Log/report bị Git bỏ qua: run/vault-demo-browser-final-2.log, run/workflow-demo/12d8bed0-c37b-4ced-b1bc-3559550c1a3c/browser-report.json, run/vault-demo-inventory-final.log, run/vault-demo-verified.json và run/document-qa/vault-demo-12d8bed0. Hồi quy213 recovery/archive/encryption +20 fixture +9 bài guard đạt, gồm marker đồng thời và từ chối report đã có. Checker mở Chromium riêng, không dùng profile người dùng. Kiểm tra xuất Word/PDF/ZIP, quyền các portal, dữ liệu từng round, Word/PDF đọc lại đúng byte và attempts vẫn1, cùng tình trạng READY hiển thị trên UI. Đây là kiểm tra tự động trên backend thật, không thay nghiệm thu của người dùng hoặc thử tải B3.

Lượt e8faef39-d12b-4356-a3ec-4e60554c8f42 đã FAILED ở PDF đầu; Word và hồ sơ vẫn giữ. Probe phiên bản riêng và chuyển cùng Word trong môi trường tương đương đều đạt; chưa khẳng định nguyên nhân cuối cùng. Đã thêm kiểm tra sẵn sàng và mã chẩn đoán hữu hạn trước khi mở demo. Giữ report, Word, vault và snapshot SQL127653 byte/SHA256 b492be97e8debd82319a19c7c9b45766f14c3123775fd3d467a8dd624fa9b8d7 trước khi dừng đúng container thử lỗi. Guard xác nhận chỉ có hồ sơ kiểm thử đã biết và DEMO3 chưa được dùng. Đây là snapshot chẩn đoán, không gọi là backup phục hồi đã nghiệm thu. Không chỉnh demo cũ hoặc reset dữ liệu để làm lượt lỗi thành đạt.

Sau khi khởi động lại môi trường máy ngày12/10, Docker và ba web demo cũ đều không chạy; container cũ tồn tại ở trạng thái Exited. Đã mở Docker Desktop và tạo container mới riêng, không start/reset/remove ba container demo cũ hoặc container dự án khác.

## Việc kế tiếp

Theo dõi và khoanh vùng dứt điểm lỗi PDF đầu ở lượt trước; readiness là rào chắn trước mở demo, không chứng minh mọi lần chuyển tương lai sẽ thành công. Chưa đổi ngân sách10 giây đọc phiên bản hoặc90 giây chuyển PDF. UI mở lượt có quyền/audit trên backend thật đã được kiểm chứng ở profile retry riêng. Tiếp backup/đối chiếu trước nâng development, rồi B3 với TCP/gói20MiB/nhiều worker và tổng tài nguyên máy. Backup ở cùng ổ D chưa đáp ứng lưu trên thiết bị khác. Không tự đóng B2/B3 hoặc Sprint4.
