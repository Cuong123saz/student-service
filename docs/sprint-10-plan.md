# Sprint 10 — Xuất bảng điểm rèn luyện và biên bản

**IN_PROGRESS, cập nhật 02/11/2026**. [Trạng thái chi tiết](sprint-10-status.json). Tiền đề: [Sprint 9 CLOSED kỹ thuật local](sprint-9-closure.md). Increment 10.1–10.3 đã hoàn thành kỹ thuật local: snapshot theo quyền, API POST tải Excel và biên bản Word/PDF. ZIP và giao diện tải còn ở các increment sau; chưa nghiệm thu mẫu chính thức của Học viện.

## Mục tiêu và hợp đồng dữ liệu đề xuất

Cố vấn/cán bộ khoa đủ quyền hiện tại xuất bảng Excel và biên bản Word/PDF theo một đợt/lớp trong phạm vi được phép; tải gói ZIP để đối chiếu các định dạng. Dùng kết quả khoa đã duyệt, giữ riêng điểm tự kê khai và lịch sử xét duyệt Sprint 8/9.

- Mỗi hàng Excel: STT, mã sinh viên, họ tên, lớp của đợt, năm học/học kỳ, điểm tự kê khai, điểm A–E được duyệt, tổng điểm được duyệt, người/thời điểm cố vấn xác nhận vòng cuối, người/thời điểm khoa duyệt, mã bản kê khai và mã quyết định cuối.
- Sheet thông tin: tên đợt, lớp/khoa, tiêu chí và phiên bản, thời điểm chốt dữ liệu, người xuất, số bản đã nộp/đã duyệt/chưa duyệt, tổng và trung bình điểm đã duyệt. Sắp xếp ổn định theo mã sinh viên và ID.
- Bảng kết quả chỉ chứa bản APPROVED. Bản chưa duyệt được thể hiện bằng số lượng ở phần thống kê, không lấy điểm tự khai thay điểm duyệt hoặc ghi điểm chưa có thành 0. Không xuất bản nháp.
- Biên bản dùng cùng snapshot với Excel: thông tin đợt/lớp, bảng điểm, tổng hợp, danh sách người đã xác nhận trong hệ thống và ghi chú nguồn dữ liệu. Chỗ ký giấy chỉ là vị trí trống; không chèn chữ ký/dấu giả.
- Chưa có mẫu chính thức: mẫu local có nhãn rõ “DỮ LIỆU THỬ NGHIỆM — CHƯA PHẢI BIỂU MẪU CHÍNH THỨC”. Không tự tạo xếp loại từ bộ A–E giả định.
- ZIP gồm Excel, Word, PDF và manifest SHA-256, cùng mã snapshot; không tự gom minh chứng sinh viên vào gói xuất điểm.

## Thứ tự thực hiện

| Increment | Đầu ra | Điều kiện nghiệm thu |
| --- | --- | --- |
| 10.1 — COMPLETE_LOCAL | ADR 0021, DTO snapshot, truy vấn có scope và kiểm lại quyền | Chốt quyền xuất; đọc cùng snapshot; giữ lớp của đợt và điểm đã duyệt; kiểm tra dữ liệu trống/chưa duyệt |
| 10.2 — COMPLETE_LOCAL | Bộ sinh XLSX và API POST tải, [hướng dẫn/kiểm chứng](sprint-10-xlsx.md) | Số hàng/tổng/trung bình khớp snapshot; mã sinh viên giữ dạng text; chuỗi không trở thành công thức; đọc lại tệp thực tế để đối chiếu |
| 10.3 — COMPLETE_LOCAL | Mẫu có phiên bản, sinh DOCX và chuyển PDF, [hướng dẫn/kiểm chứng](sprint-10-minutes.md) | Tiếng Việt/font đúng; bảng dài lặp tiêu đề; không cắt hàng/chữ; tên dài và nhiều trang đọc được; rà trang đã render |
| 10.4 — Giao diện và ZIP | Xem phạm vi/số lượng trước tải, tải từng định dạng và gói | Trạng thái tải/lỗi rõ; nút dùng thành phần chung; 401/403 xóa dữ liệu; kiểm ZIP/hash và tính nhất quán giữa các tệp |
| 10.5 — Diễn tập và đóng | Kiểm thử, runbook, báo cáo/ảnh/tệp mẫu, hồ sơ đóng | Kiểm thử quyền/đồng thời/audit và trình duyệt; trực tiếp rà Excel/Word/PDF; bảo toàn Sprint 8/9; chỉ đóng khi toàn bộ tiêu chí đạt |

Không đặt thời lượng sprint khi chưa có ước lượng và năng lực thực hiện. Làm xong, kiểm chứng từng increment trước khi mở increment tiếp theo.

## Ràng buộc triển khai

Tuân thủ [quy ước phát triển](development-guidelines.md). Route kiểm session/đầu vào; repository quản lý scope và snapshot; service nhận dependency qua constructor. Tái sử dụng quy tắc quyền hiện tại của training-review; định nghĩa permission xuất trong ADR trước khi thay catalog, không mặc định SYSTEM_ADMIN có quyền nghiệp vụ hoặc chỉ dựa vào việc ẩn nút trên UI.

Đọc dữ liệu trong transaction ngắn với snapshot nhất quán, chốt DTO rồi mới sinh tệp/chạy converter. Không giữ khóa database trong lúc I/O. Kiểm quyền trước và sau sinh tệp; thu hồi quyền/phân công phải chặn tải tiếp. Tệp riêng tư, cache private/no-store, tên tệp an toàn, có giới hạn số hàng/dung lượng/thời gian và dọn tệp tạm. Nếu dữ liệu thay đổi giữa các yêu cầu xuất riêng, mỗi tệp phải thể hiện snapshot riêng; gói ZIP phải dùng một snapshot chung.

Không sửa migration cũ hoặc snapshot đã nộp. Chỉ thêm schema khi ADR nêu nhu cầu lưu bền vững; ưu tiên hợp đồng xuất từ dữ liệu hiện có. Audit lần xuất không được ghi nội dung riêng tư hoặc storage key vào log.

## Các ca kiểm chứng bắt buộc

1. Sai session, role, permission, scope, phân công hết hiệu lực và thu hồi quyền giữa lúc sinh/tải; tài khoản khác lớp/khoa không nhận dữ liệu.
2. Đợt không có bản, chỉ có bản chờ duyệt, có cả chờ và đã duyệt; phân biệt 0 và chưa có điểm; sinh viên chuyển lớp và tên/mã dài có dấu.
3. Khoa duyệt đồng thời lúc xuất: hàng và thống kê trong cùng gói không mâu thuẫn; tổng điểm dựa trên quyết định APPROVED cuối, không cộng vòng cũ.
4. Chuỗi bắt đầu bằng ký tự công thức Excel, mã có số 0 đầu, tên tệp có ký tự đặc biệt; nội dung trở thành text an toàn.
5. Converter thiếu/lỗi/quá thời gian, tác vụ lớn và khách ngắt kết nối; lỗi có thể xử lý, dọn tài nguyên, không trả PDF rỗng hoặc giả định thành công.
6. Mở và đối chiếu XLSX/DOCX/PDF/ZIP thật; rà bảng nhiều trang, tiếng Việt, khổ in và manifest; diễn tập trình duyệt 375/768/1024/1440 px bằng dữ liệu giả riêng.

## Ngoài phạm vi

Quy chế/xếp loại chính thức, mẫu cơ quan chưa được cung cấp, chữ ký số/chứng thư thật, triển khai production, UAT cơ quan và nghiệm thu phục hồi toàn hệ thống thuộc mốc sau. Sprint 10 không sửa điểm đã duyệt hoặc mở lại quy trình Sprint 9.


## Kết quả increment 10.1 — 23/10/2026

[ADR 0021](adr/0021-training-point-export-snapshot.md) chốt sử dụng quyền nghiệp vụ hiện tại, không thay catalog/schema. Repository đọc một snapshot REPEATABLE READ READ ONLY: chỉ bản khoa đã duyệt, đúng parent của cố vấn vòng cuối, giữ student/actor snapshot và số 0 thật, metadata nguồn, UUID lượt đọc và nhãn thử nghiệm. Service kiểm lại quyền ở transaction mới trước khi trả DTO. Danh sách là mảng thuần, không lộ kiểu Result của thư viện PostgreSQL. Giới hạn 1.000 bản duyệt, timeout mỗi statement 10 giây; vượt giới hạn từ chối, không cắt âm thầm. Giới hạn tải lớn chưa có bài thử biên riêng.

Kiểm chứng: runner repository **18 đạt** (17 ca con và 1 nhóm; gồm 4 ca export mới), unit service **1 đạt**, không thất bại hoặc bỏ qua ở lượt cuối. Có ca khoa duyệt xen giữa đọc hàng/thống kê, quyền bị thu hồi sau đọc snapshot, trống/nháp/chưa duyệt, điểm 0, vòng trả về/xác nhận lại và giữ dữ liệu sau chuyển lớp/đổi tên. Typecheck/lint API đạt; API build và định dạng phần sửa đạt. Log đầu có hai ca thất bại do trả mảng Result; đã chuẩn hóa DTO và giữ log lỗi cùng log chạy cuối để truy vết. Không cộng lại vào tổng kiểm thử Sprint 9.

Bằng chứng: `C:/Users/Personal/Documents/ChatGPT/New project/sprint10-1/verification/`. Kiểm thử tự tạo/xóa database giả riêng trên PostgreSQL test 5434 và dừng container test sau khi chạy; không migrate database development/production. Hash các runtime Sprint 9 ngoài hai tệp repository/test chủ đích sửa đều khớp. Chưa commit/push, Sprint 10 chưa đóng. Bước kế tiếp 10.2: bộ sinh XLSX và API tải; phải kiểm quyền sau sinh tệp và bổ sung audit tải thực tế, capture nội bộ không thay các kiểm tra đó.


## Kết quả increment 10.2 — 23/10/2026

Đã có POST /api/v1/user/training-reviews/periods/:id/export.xlsx, body {}. XLSX hai sheet, giữ mã sinh viên dạng chữ, điểm dạng số và ngày UTC+7, không tạo công thức từ chuỗi đầu vào. Kiểm lại quyền sau render và ghi audit cùng transaction; lỗi quyền/audit không trả tệp. 9 unit và 19 theo runner SQL/HTTP đạt; typecheck/lint/build API và kiểm định dạng đạt. Đã đọc lại XLSX, rà hai sheet bằng LibreOffice/Poppler và ghi hash bằng chứng. [Chi tiết sử dụng, giới hạn và kiểm chứng](sprint-10-xlsx.md). Chưa có nút tải UI, chưa xuất Word/PDF/ZIP, Sprint 10 chưa đóng. Bước kế tiếp 10.3.


## Kết quả increment 10.3 — 02/11/2026

[ADR 0023](adr/0023-training-minutes-docx-pdf.md). Có POST `.../periods/:id/minutes.docx` và `.../minutes.pdf`, body `{}`. DOCX sinh bằng OpenXML trong code, mẫu `training-minutes-v1` được ghim bằng hash nội dung, A4 ngang, nhãn thử nghiệm mọi trang, bảng lặp tiêu đề và không tách hàng, khối ký trên giấy để trống. PDF chuyển từ đúng byte DOCX qua `LibreOfficePdfConverter`; audit và header ghi SHA-256 DOCX nguồn. Lỗi converter trả 503 riêng, không audit, không trả PDF hỏng. Excel và Word dùng chung kiểm toàn vẹn snapshot. Kiểm lại quyền và ghi audit sau render/chuyển đổi như 10.2.

Kiểm chứng: unit 10 ca mới (1 ca PDF thật opt-in, đã chạy đạt), 1 ca HTTP/SQL mới; toàn bộ unit/integration API, typecheck, lint, format đạt. Đã render PDF thật 3 trang (fixture) và 14 trang (120 dòng), rà ảnh trang và trích text. Microsoft Word desktop chưa kiểm. [Chi tiết](sprint-10-minutes.md). Bước kế tiếp 10.4: UI tải, CORS expose header, ZIP một snapshot kèm manifest.
