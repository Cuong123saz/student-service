---
status: Accepted
date: 2026-10-11
scope: Local technical continuation; synthetic data
---

# ADR 0010: Kho tài liệu đầu ra, công bố có lease và phục hồi đủ byte

Quyết định kỹ thuật theo yêu cầu tiếp tục tự thực hiện của chủ dự án. Không ghi nhận nghiệm thu, mẫu chính thức, thẩm quyền ký hoặc hiệu lực pháp lý. Giữ ADR0001–0009 và STUDENT_CONFIRMATION OFFLINE tại CTSV. ADR này cụ thể hóa phần B của ADR0009; chỉ những phần có bằng chứng trong tiến độ mới được coi là đã triển khai.

## Đơn vị bất biến và khả năng tải Word

Một round có một bộ DECLARATION, trạng thái nghiệp vụ UNSIGNED_DECLARATION. Bản Word được lưu và công bố trước. PDF có thể được bổ sung sau, nhưng bắt buộc chuyển từ chính byte Word đã công bố; không render lại Word để làm PDF. Lỗi PDF không thu hồi Word, không đổi hồ sơ và không yêu cầu sinh viên gửi lại. Đây là điều chỉnh cách công bố nguyên cặp ở ADR0009 để giữ khả năng tải Word khi converter hỏng.

Mỗi định dạng công bố đúng một lần, unique theo bộ/format, append-only. PDF ghi docx SHA-256 làm quan hệ dẫn xuất. ZIP chỉ sẵn sàng khi cả hai định dạng đã được kiểm chứng. Lần tải sau đọc byte đã lưu và đối chiếu size/hash; thiếu/hỏng trả lỗi toàn vẹn, tuyệt đối không âm thầm sinh lại để che mất bản cũ. Nâng cấp renderer chỉ ảnh hưởng bộ chưa có Word. Kết quả phát hành sẽ là loại khác, không ghi đè DECLARATION.

## Registry và job dự kiến trước DDL

- `submission_document_sets`: UUID bộ; FK `(round_id, submission_id)` về round; kind DECLARATION; unique `(round_id, kind)`; template binding khớp round; thời điểm tạo. Append-only, không cascade xóa lịch sử.
- `submission_documents`: UUID bản; FK bộ; format DOCX hoặc PDF; key UUID của lần ghi riêng định dạng; size/hash; template binding; renderer version/build digest, Node/ICU khi tạo Word; converter version/binary digest khi tạo PDF; source DOCX hash chỉ bắt buộc cho PDF; trạng thái cố định UNSIGNED_DECLARATION; thời điểm công bố. Unique `(set_id, format)` và storage key. Trigger chặn update/delete, kiểm tra liên kết round/template và PDF dẫn xuất đúng Word đã công bố. Khóa bộ theo thứ tự thống nhất để serialize publish.
- `submission_document_jobs`: unique `(set_id, format)`; state PENDING/RUNNING/RETRYABLE/COMPLETE; attempt UUID dùng làm fencing token; lease_until; attempts, next_attempt_at; error code hữu hạn; published_document_id khi COMPLETE. Claim/reclaim dùng giờ PostgreSQL và transaction ngắn; không dùng giờ client làm điều kiện thắng. Không giữ transaction hoặc khóa round trong lúc render/converter/ghi đĩa.

Chỉ publish nếu token và lease còn hiện hành trong cùng transaction khóa job/bộ; worker cũ bị thu hồi lease không thể publish. Word đã có thì không claim tạo Word nữa; PDF claim đọc Word qua registry. Giới hạn hai converter trong một process chỉ là giới hạn local; job phải có quota/worker slots chung trước nhiều instance. Retry có backoff và số lần hữu hạn, không loop không giới hạn trong một HTTP request. Request đang tạo trả mã có thể thử lại; kiểm tra quyền hiện tại trước claim/read và lần nữa trước trả byte. Chạy job kỹ thuật không được giả audit duyệt hoặc gửi thông báo phát hành.

## Kho và điểm chết tiến trình

Kho output là root tuyệt đối riêng, không nằm trong/bao quanh kho minh chứng, không dùng thư mục dự án như kho production. Layout cuối: UUID phẳng, một UUID cho một file; registry mới biết định dạng, giới hạn DOCX 16 MiB/PDF 16 MiB. Template catalog là kho riêng, tên `submission-summary-vN.docx`, tối đa 1 MiB, hash trùng catalog đã pin. Không nhận đường dẫn/tên file từ request. Root và entry phải là thư mục/tệp thật, từ chối symlink/junction và vượt giới hạn trước đọc.

Ghi vào staging thuộc attempt; mở độc quyền, ghi hết và fsync, kiểm tra hash/size, sau đó công bố file cuối không ghi đè (exclusive link/copy và fsync phù hợp nền tảng). Kiểm chứng cuối trước commit registry. DB publish là điểm tài liệu bắt đầu được tải. Không tuyên bố chống mất điện chỉ từ rename; fsync thư mục và nền tảng phải có bằng chứng riêng.

Process chết trước file cuối: staging còn lại. Chết sau file cuối trước DB: orphan được bảo toàn, audit báo, không tự cấp thành tài liệu đã công bố. Chết sau commit trước HTTP response: request sau tìm registry và trả cùng byte; không sinh lại. Lease hết hạn giữa chuyển PDF: kết quả worker cũ không publish; giữ file để đối soát. Lỗi commit không rõ thành công hay chưa: đọc registry và đối chiếu token/hash; DB không đọc được thì giữ byte, không cleanup dựa trên suy đoán.

Chưa tự xóa staging/orphan. Công cụ cleanup tương lai cần thời gian giữ, job lease đã hết, transaction chứng minh không có tham chiếu và phê duyệt thao tác cụ thể. Audit kỹ thuật chỉ chứa UUID/hash/version/code, không câu trả lời, mật khẩu hoặc đường dẫn riêng tư.

## Backup và restore là điều kiện mở tính năng

Recovery bundle v1 hiện chỉ có database.dump, files và manifest. Giữ đọc v1 cho các bản sao cũ. Bundle v2 bổ sung `templates/` và `documents/`, mỗi kho vẫn UUID phẳng hoặc tên mẫu đúng catalog; manifest có digest từng file và metadata phân biệt định dạng/round/template/nguồn Word. Không đưa output vào `files/` giới hạn 5 MiB. Kiểm tra registry từ DB snapshot trước và sau copy, không coi manifest tự khai là nguồn tin cậy thay DB.

Freeze tất cả writer: API, job/converter, importer và công cụ ghi kho. Đợi lease/worker dừng; giữ DB snapshot/khóa phù hợp cùng inventory kho. Backup giữ mọi file cuối và staging chưa đối soát trong vùng riêng hoặc từ chối tạo bản backup sạch khi chưa xử lý; không bỏ qua orphan im lặng. Đối chiếu size/hash, liên kết round, binding mẫu, PDF-source-Word; catalog giữ đủ mẫu lịch sử và hash. Gói backup không chứa binary LibreOffice hoặc khóa ký: phải ghi yêu cầu runtime/phiên bản, tách key theo chính sách sau này.

Restore vào DB và ba root mới, không ghi đè nguồn. Kiểm tra layout/giới hạn/hash trước tạo đích; so sánh registry với kho sau restore, đọc lại cùng byte qua quyền owner/reviewer/admin. Job RUNNING phục hồi phải được vô hiệu hóa lease có kiểm soát trước khi worker hoạt động; không tự coi đang chạy là COMPLETE. Bản v1 không chứa output không đủ phục hồi hệ thống đã bật output registry; công cụ phải từ chối trường hợp đó, không tự sinh lại tài liệu.

Định dạng archive thường và mã hóa phải hỗ trợ v2 cùng lúc; validator phải chặn đường dẫn, duplicate, thiếu/thừa và tệp lớn. Giữ xác minh v1. Kiểm tra ít nhất: Word tải khi PDF lỗi; hai worker/lease takeover; process chết ở ba điểm; commit response mất; thay byte, thêm byte, thiếu template; backup dở và source đổi; khôi phục nguyên byte trên DB/kho tách biệt; quyền bị thu hồi trong lúc tạo. Chỉ bật route dùng registry khi tất cả điều kiện này đạt.

## Phân kỳ có thể kiểm chứng

B1: recovery v2 giữ template catalog và output namespace, tương thích v1, archive/mã hóa và fault tests; thử bằng tài liệu giả. Chưa bật lưu qua route, chưa có registry DB thì rehearsal phải ghi rõ output metadata là fixture kỹ thuật, không giả kiểm chứng liên kết registry thật.

B2: migration registry/job cùng rào chắn ADR0009+0010, repository/lease và vault; kiểm chứng SQL/integration/điểm chết, mở trong demo riêng. Cập nhật rehearsal đọc registry thật rồi mới bật development. Không migrate các demo cũ đang thực hành.

B3: đo TCP và nhiều worker theo dung lượng thật, backup ngoài thiết bị nguồn, UAT. Mock signer chỉ sau nền tảng lưu byte, không biến checksum hoặc ảnh dấu thành chữ ký hợp lệ.
