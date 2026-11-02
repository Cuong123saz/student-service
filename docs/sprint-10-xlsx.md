# Sprint 10.2 — Xuất Excel kết quả đã duyệt

Increment kỹ thuật local hoàn thành ngày 23/10/2026, theo [ADR 0022](adr/0022-training-point-xlsx-download.md). Sprint 10 vẫn IN_PROGRESS; biên bản Word/PDF, ZIP và nút tải trên giao diện còn ở các increment sau.

## Gọi API

`POST /api/v1/user/training-reviews/periods/:id/export.xlsx`, body JSON `{}`. Dùng cookie session cổng user và Origin của cổng dịch vụ; trình duyệt gửi Origin tự động với POST. Không nhận query/filter hoặc trường body bổ sung. GET/HEAD không tạo tệp. Chưa có endpoint xuất ở cổng admin hoặc nút tải trên giao diện.

Quyền theo ADR 0021: cố vấn cần đúng role + permission + scope + phân công còn hiệu lực; khoa cần role + permission + scope khoa/toàn hệ thống phù hợp. SYSTEM_ADMIN không tự thay vai trò nghiệp vụ. Quyền được kiểm khi đọc và trong transaction ghi audit sau sinh tệp. Thu hồi quyền/phân công giữa hai bước chặn trả byte.

Phản hồi thành công là XLSX attachment, tên `training-points-<snapshot UUID>.xlsx`, có `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `X-Export-Snapshot-Id`, `X-Export-Sha256`. Phản hồi lỗi giữ no-store và không trả header nhận dạng/tệp. Header checksum hiện dành cho HTTP; việc dùng qua CORS và xử lý tải trên trình duyệt thuộc 10.4.

Lỗi chính: 401 session/audience sai; 403 thiếu role/permission hoặc Origin sai; 404 đợt ngoài scope/phân công; 400 UUID/body/query sai; 422 vượt giới hạn/tệp lớn; 429 đang xuất hoặc vượt rate limit; 409 snapshot không nhất quán. Audit thất bại trả lỗi, không trả byte Excel.

## Nội dung tệp

- **Thông tin**: đợt/lớp/khoa, người xuất, thời điểm chốt UTC+7, UUID snapshot, tiêu chí và các số đếm. Tổng/trung bình chỉ tính bản khoa đã duyệt. Trung bình rỗng giữ trống, không đổi thành 0.
- **Kết quả đã duyệt**: chỉ APPROVED; mã/tên/lớp lúc nộp, điểm tự khai, điểm A–E đã duyệt, tổng duyệt, cố vấn vòng cuối, khoa duyệt, thời điểm và mã/hash đối chiếu. Đóng băng bốn hàng và bốn cột nhận dạng; có bộ lọc tiêu đề.
- Mã sinh viên giữ text và số 0 đầu; số điểm/số đếm là numeric; thời điểm là Excel serial có định dạng UTC+7. Tệp là snapshot giá trị, không có công thức tự đổi điểm khi người dùng sửa file. Chuỗi giống công thức được ghi literal inlineStr; không tạo hyperlink ngoài hoặc macro.
- Tệp luôn ghi rõ dữ liệu thử nghiệm/chưa phải biểu mẫu chính thức, không tự gán xếp loại hoặc giả chữ ký. Các cột hash/receipt nằm phía phải, bảng rộng cần cuộn ngang; chưa đặt đây là mẫu biên bản để in A4.

Tối đa 1.000 bản duyệt và 8 MiB byte nén; tối đa hai tác vụ/instance và một tác vụ/tài khoản; rate limit 5 yêu cầu/phút/IP. Quá giới hạn từ chối rõ, không cắt hàng. Sinh trong bộ nhớ, không tạo tệp riêng tư tạm trên đĩa. Chưa có điều phối tác vụ liên instance hoặc biên hiệu năng production.

## Audit

`training.export.xlsx.prepared` ghi actor hiện tại, ngữ cảnh request, periodId, snapshotId, số hàng, dung lượng và SHA-256. Không ghi tên sinh viên, điểm, nhận xét hoặc nội dung bảng trong metadata. Kiểm quyền và ghi audit cùng transaction có khóa SHARE, chỉ sau khi sinh tệp xong; render không giữ transaction/khóa. Audit SUCCESS nghĩa là đã chuẩn bị và cho phép trả phản hồi, không chứng minh trình duyệt đã nhận đủ hoặc lưu tệp. Mỗi yêu cầu thành công tạo một snapshot riêng.

## Kiểm chứng ngày 23/10/2026

| Nhóm | Kết quả |
| --- | --- |
| XLSX + service unit | 9 đạt, 0 lỗi/skip: round trip, mã 0 đầu, kiểu số, chuỗi công thức, trống/0, biên 1.000/1.001, DTO hỏng, mất quyền/audit/render/dung lượng, nhả slot, làm tròn 201/200 thành 1,01 |
| Repository + HTTP/SQL | 19 theo runner đạt (18 ca con và 1 nhóm), 0 lỗi/skip; gồm ca POST mới, session/audience/Origin/scope, query/body thừa, chặn GET, audit/hash, mất quyền sau render, lỗi audit không trả byte và rate limit |
| Chất lượng | Typecheck API, lint API và lint phần sửa cuối, build API, định dạng phần sửa và git diff --check đạt |
| Đọc độc lập | read-excel-file đọc XLSX thật; Artifact Tool import kiểm đúng các giá trị chính |
| Hiển thị thực tế | LibreOffice Calc 26.8.1.1 đọc tệp mẫu, xuất hai sheet thành hai trang QA; Poppler render và trực tiếp rà cả hai sheet, gồm toàn bộ cột receipt/hash qua ảnh chia đoạn |

Bộ xem trước Artifact Tool hiển thị `001234` thành `1234` dù giá trị import vẫn là chuỗi đúng, và bỏ tiêu đề khi merge vượt vùng crop. Đối chiếu LibreOffice xác nhận mã và tiêu đề hiển thị đúng. Không sửa mã gốc hoặc thêm dấu nháy vào dữ liệu để bù lỗi bộ xem trước. Microsoft Excel desktop chưa được thao tác trực tiếp. PDF ở thư mục QA chỉ dùng đối chiếu tệp Excel, không phải chức năng biên bản PDF của increment 10.3.

Log đầu có lỗi gọi reader sai API; đã sửa cách chọn sheet theo phiên bản hiện có. Reader có sai số một mili giây khi chuyển phần lẻ ngày Excel, được kiểm với dung sai 1 ms. Đã sửa thứ tự tính trung bình để tránh sai số JavaScript ở ca 201/200; regression test chốt 1,01. Các log trước/final được giữ, không cộng lặp các lượt chạy.

Bằng chứng local: `C:/Users/Personal/Documents/ChatGPT/New project/sprint10-2/verification/`. Tệp minh họa: `C:/Users/Personal/Documents/ChatGPT/New project/sprint10-2/output/training-points-sprint10-2.xlsx`, chỉ dữ liệu giả. Chỉ mục hash ghi nguồn/tệp/log/ảnh ở proof-index.json. Kiểm thử tự tạo/xóa database giả riêng trên PostgreSQL test 5434 và dừng container test; không migrate/khởi động nguồn development/production, không thay schema/catalog. Chưa commit/push. Bước tiếp theo: **10.3 — biên bản Word/PDF**.
