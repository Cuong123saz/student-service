# Sprint 10.3 — Biên bản Word/PDF điểm rèn luyện

**COMPLETE_LOCAL ngày 02/11/2026.** Quyết định thiết kế: [ADR 0023](adr/0023-training-minutes-docx-pdf.md). Tiền đề: [snapshot ADR 0021](adr/0021-training-point-export-snapshot.md), [Excel ADR 0022](adr/0022-training-point-xlsx-download.md). Chưa có nút tải trên UI, chưa có ZIP; Sprint 10 chưa đóng; production NOT_READY.

## Sử dụng

```http
POST /api/v1/user/training-reviews/periods/{periodId}/minutes.docx
POST /api/v1/user/training-reviews/periods/{periodId}/minutes.pdf
Cookie: user_session=…
Origin: <CORS_ORIGIN>
Content-Type: application/json

{}
```

Quyền giống Excel: cố vấn có phân công còn hiệu lực hoặc cán bộ khoa đúng role/permission/scope của lớp trong đợt. Query hoặc body thừa trả 400; GET không tồn tại (404).

| Kết quả | Ý nghĩa |
| --- | --- |
| 200 | Tệp đính kèm `training-minutes-<snapshotId>.docx/.pdf`; header `X-Export-Snapshot-Id`, `X-Export-Sha256`, `X-Export-Template-Version`; PDF có thêm `X-Export-Source-Docx-Sha256` |
| 401 / 403 / 404 | Không có session user / sai Origin hoặc thiếu quyền / không thuộc phạm vi hoặc mất quyền trong lúc sinh tệp |
| 409 `TRAINING_EXPORT_INTEGRITY` | Snapshot không nhất quán, không sinh tệp |
| 422 `TRAINING_EXPORT_TOO_LARGE` | Hơn 1.000 bản đã duyệt, DOCX > 8 MiB hoặc PDF > 16 MiB |
| 429 | Tài khoản đang có tác vụ xuất khác (dùng chung với Excel), instance đã đủ 2 tác vụ, hoặc vượt 5 yêu cầu/phút/IP của route |
| 503 `TRAINING_EXPORT_PDF_*` | PDF bận/cách ly/không tạo được; không ghi audit, vẫn tải được Word |

Cấu hình converter: `LIBREOFFICE_PATH` (mặc định `soffice`, Windows `soffice.com`), giống tài liệu thủ tục. Không hard-code đường dẫn máy.

## Nội dung mẫu `training-minutes-v1`

A4 ngang. Nhãn “DỮ LIỆU THỬ NGHIỆM — CHƯA PHẢI BIỂU MẪU CHÍNH THỨC” ở đầu thân và header mọi trang. Các mục: I. Thông tin chung, II. Thống kê, III. Tiêu chí (giả định), IV. Kết quả đã được khoa duyệt (STT, mã SV, họ tên và lớp lúc nộp, điểm tự khai, điểm A–E duyệt, tổng duyệt, cố vấn và khoa kèm thời điểm UTC+7), V. Người đã xác nhận trong hệ thống, VI. Ghi chú nguồn dữ liệu, VII. Xác nhận trên giấy (để trống). Footer: mã snapshot, phiên bản mẫu, “Trang X / Y”.

Đổi bố cục phải tăng `trainingMinutesTemplate.version` và cập nhật pin trong `training-export.docx.test.ts`.

## Kiểm chứng ngày 02/11/2026

Môi trường: container Linux cloud, Node 22.23.4 (pin `.nvmrc` 22.23.2, lệch bản patch), PostgreSQL 17 test qua `docker-compose.test.yml` (5434, tmpfs), LibreOffice có sẵn trong container, Poppler `pdftotext/pdfinfo/pdftoppm`. Không dùng DB development/production.

Baseline trước khi sửa (commit `4034d89`): typecheck API/web, lint API, format check đạt; unit API 6 discovery + 194 đạt/1 bỏ qua (ca Windows); integration API 356 đạt; storage/recovery/bundle 312 đạt; web 147 đạt; ADR gate 51 đạt.

Sau thay đổi:

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run check`, `npm run lint`, `npm run format:check` | Đạt |
| Unit API | 6 discovery + 203 đạt, 2 bỏ qua: ca Windows có sẵn và ca PDF thật opt-in. Mới: 6 ca DOCX (1 opt-in), 4 ca service |
| Ca PDF thật `TRAINING_MINUTES_REAL_PDF=true` | Đạt (chạy riêng `training-export.docx.test.ts`) |
| Integration API | 357 đạt; runner training-review 20 đạt (19 ca con + 1 nhóm), có 1 ca HTTP/SQL biên bản mới |
| Các test Excel 10.2 | Vẫn đạt, metadata audit XLSX giữ đúng 5 khóa |

Rà tệp thật (sinh qua `createTrainingMinutesDocx` + `LibreOfficePdfConverter`, dữ liệu giả):

| Tệp | Trang | SHA-256 |
| --- | --- | --- |
| fixture DOCX (2 bản duyệt) | — | `2a682a5d9c4a03c1946c3e4cae978e61dbab3e1b8991e0764e8f4d01982db352` |
| fixture PDF | 3, A4 ngang | `37cbfb47eba5f230677c1e9616eaaf4d875bf08c4f040891478d39b72d58bd4f` |
| 120 bản duyệt, tên dài/chuỗi liền 70 ký tự PDF | 14, A4 ngang | `233b9af2c43fbd9136acf2491016273ac8612ae3b2eb2ecf129d2e2e4da16aa3` |

- `pdftotext` trích đúng tiếng Việt có dấu. Bản 120 dòng có đủ 120 mã sinh viên, tiêu đề bảng lặp trên 12 trang có bảng.
- Ảnh trang đã xem trực tiếp: không hàng nào bị cắt qua trang, tên dài và chuỗi liền xuống dòng trong ô, thời điểm và `(UTC+7)` nằm trên một dòng, khối ký đi cùng phần ghi chú, số trang đúng.
- Bản không có bản duyệt in câu nêu rõ, không có hàng điểm 0.
- PDF byte có thể khác giữa các máy/phiên bản LibreOffice; DOCX từ cùng snapshot là xác định.

## Giới hạn còn lại

- Font: container dùng Liberation Serif thay Times New Roman (tương thích metric). **Microsoft Word desktop và LibreOffice trên Windows chưa được rà trực tiếp.**
- CI chưa cài LibreOffice nên ca PDF thật chỉ chạy khi bật cờ; ca HTTP/SQL dùng converter giả.
- Bằng chứng ảnh/tệp nằm trong thư mục tạm của phiên làm việc, không commit; muốn xác minh lại hãy chạy các lệnh trên.
- Converter biên bản và converter thủ tục là hai instance riêng (tối đa 4 LibreOffice/process). Concurrency và rate limit theo instance.
- Chưa có UI, CORS expose header và ZIP một snapshot (10.4); chưa diễn tập trình duyệt và đóng sprint (10.5).
