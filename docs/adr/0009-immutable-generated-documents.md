---
status: Accepted
date: 2026-10-11
scope: Local technical continuation; synthetic data
---

# ADR 0009: Gắn phiên bản mẫu và lưu tài liệu đầu ra bất biến

Tiếp tục công việc kỹ thuật theo yêu cầu tự thực hiện của chủ dự án. Quyết định này không ghi nhận nghiệm thu, thẩm quyền ký hoặc mẫu chính thức của Học viện. Giữ ADR0001–0008: STUDENT_CONFIRMATION OFFLINE tại CTSV; phiếu kê khai chưa ký; duyệt nội dung và phát hành là hai việc riêng.

## Vấn đề

Round đã giữ nguyên dữ liệu và minh chứng, nhưng renderer đang chọn một hằng mẫu v1 hiện tại. Khóa SHA-256 ngăn sửa file v1; chưa gắn lựa chọn mẫu với từng round. PDF/ZIP được sinh lại có thể khác metadata thời gian. Một bản định ký phải được nhận diện bằng chính byte đã lưu, không chỉ bằng dữ liệu đầu vào hoặc một tên mẫu.

Kho minh chứng và công cụ phục hồi hiện chỉ hiểu UUID phẳng, tệp tối đa 5 MiB và tham chiếu từ submission_files/round.files. Đặt tài liệu đầu ra vào kho đó ngay sẽ khiến audit coi chúng là tệp mồ côi, hoặc phục hồi bỏ sót/từ chối tệp lớn. Không bật lưu đầu ra trước khi sửa và kiểm chứng toàn bộ đường phục hồi.

## Quyết định và các phần triển khai

### A. Gắn mẫu với từng round

Migration0022 thêm JSONB declaration_template bắt buộc vào submission_rounds, gồm đúng id, sha256 và bindingSource. Giá trị được ghi cùng transaction chốt round; không nhận từ request của sinh viên/cán bộ. Dùng SUBMITTED cho round mới. Round có trước migration nhận v1/hash đã khóa và LEGACY_V1 qua DEFAULT khi thêm cột; không UPDATE lịch sử, không tắt trigger. Bỏ DEFAULT ngay sau backfill để mọi writer mới phải khai báo chủ động. LEGACY_V1 chỉ là quy ước tương thích với renderer v1 đã dùng, không chứng minh byte nào đã được tải hoặc ký trước đây.

Trigger append-only bảo vệ cả cột mới. Constraint kiểm tra object/đúng ba khóa, id theo submission-summary-vN, hash hex64 và nguồn hợp lệ. Catalog mã nguồn giữ riêng các phiên bản mẫu bất biến. Renderer chọn đúng binding của round; thiếu, không biết id, sai hash hoặc file bị sửa thì trả DOCUMENT_TEMPLATE_UNAVAILABLE, không fallback sang mẫu hiện tại. Chưa tạo v2. Khi thêm v2 phải giữ v1 và thử tải lại round cũ.

API bổ sung declarationTemplate vào round; giao diện hiện có có thể bỏ qua metadata này. Manifest ZIP mới kèm bindingSource trong template, công cụ kiểm tra vẫn nhận ZIP version1 cũ không có thuộc tính này. Mã hash không thành chữ ký hoặc bằng chứng nguồn gốc. Không sửa byte mẫu v1 để in thêm nguồn binding.

Phần A không lưu file đầu ra, không đổi trạng thái hồ sơ, quyền xét, notification, audit nghiệp vụ hoặc layout. Kiểm tra kho minh chứng không cần tham chiếu mới vì chưa sinh thêm tệp kho. Database dump giữ cột mới; thử phục hồi fake phải so sánh binding từng round sau restore.

### B. Lưu byte đầu ra trước khi ký — phần kế tiếp

Dùng registry tài liệu riêng, append-only, liên kết round và loại DECLARATION; pin id/hash mẫu, định dạng, size/hash, storage key, thời điểm tạo và phiên bản renderer/converter. Word/PDF là một cặp: PDF chuyển từ đúng Word đó. Tạo qua staging riêng, kiểm tra cấu trúc/dung lượng/hash, công bố bằng transaction có khóa/unique theo round và loại; tải lại đọc byte đã lưu. Hai request không được sinh hai bản cùng được công bố. Nếu converter lỗi, không xuất metadata thành công; lỗi tạo không yêu cầu gửi lại hồ sơ.

Không giữ transaction DB qua thời gian chạy converter. Cần lease/job với thời hạn, idempotency, retry có kiểm soát và xử lý tình huống process chết giữa ghi file/công bố. Không tự xóa tệp khi chưa chứng minh không có registry tham chiếu. Audit kỹ thuật ghi mã tài liệu/round/hash/version và kết quả, không ghi câu trả lời, khóa bí mật hoặc giả quyết định nghiệp vụ. Registry lưu trạng thái UNSIGNED_DECLARATION, không dùng APPROVED như ISSUED.

Bắt buộc thiết kế kho output riêng hoặc namespace được hỗ trợ đầy đủ. Audit liệt kê cả tham chiếu output, đối chiếu size/hash và cặp tài liệu; backup freeze phải bao gồm registry, template catalog và tất cả byte. Restore phải khôi phục vào kho tách biệt, so sánh byte/hash/round, chặn thiếu/hỏng/orphan, không ghi đè nguồn. Chỉ bật tính năng sau khi đường backup/restore và fault injection đạt. Migration cho phần B cần bổ sung ADR chi tiết registry/lease/kho trước khi viết DDL; phần A không ngầm phê duyệt một schema tùy ý cho phần B.

### C. Mô phỏng ký và phát hành

Mock signer chỉ dùng sau phần B, ghi rõ mô phỏng, không tạo giá trị chữ ký kỹ thuật hợp lệ cho tài liệu. Chữ ký thật/kiểm chứng thật còn phụ thuộc chính sách tin cậy, mẫu được ban hành, thẩm quyền và đơn vị phát hành. Quyền ADMIN/review không cấp quyền ký. Không dùng ảnh dấu làm điều kiện phát hành.

## Kiểm chứng và vận hành phần A

ADR này phải commit trước migration0022; rào chắn ADR bổ sung yêu cầu0009 cho submission_rounds và các bảng output tương lai. Migration test tạo dữ liệu ở schema cũ, đối chiếu mọi giá trị cũ, file/audit/notification/quyền không đổi; kiểm tra legacy binding, bắt buộc writer khai báo và cấm sửa binding. Integration kiểm tra gửi/bổ sung/hai round, owner/reviewer/admin, thu quyền lúc converter chạy và manifest đúng round. Unit kiểm tra unknown id/hash không fallback, template bị sửa và giữ byte Word v1.

Chạy build/typecheck/lint/test, demo trình duyệt fake và recovery rehearsal fake trước khi nâng cấp DB development. Development phải sao lưu/đối chiếu dữ liệu trước/sau; không reset database, không migrate các demo đang dùng runtime cũ. Môi trường dùng chung/production cần lịch nâng cấp code/schema cùng nhau vì writer cũ không biết cột bắt buộc. Quay lui bằng code vẫn hiểu binding; không xóa cột/mẫu hoặc tái sinh tài liệu để che lỗi. Kết quả đo và phạm vi thực thi ghi trong tài liệu tiến độ, không biến dự kiến thành bằng chứng.
