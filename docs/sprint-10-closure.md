# Sprint 10 — Hồ sơ đóng kỹ thuật local

**CLOSED ngày 02/11/2026**, phạm vi **LOCAL_TECHNICAL**, theo yêu cầu của chủ dự án “merge rồi tiếp tục công việc tiếp” sau khi 10.3 được merge. Đây không phải nghiệm thu thủ công độc lập hay phê duyệt của Học viện. Production **NOT_READY**. [Trạng thái máy đọc](sprint-10-status.json), [kế hoạch](sprint-10-plan.md), [runbook](sprint-10-runbook.md).

## Kết quả

Cố vấn và cán bộ khoa có quyền hiện tại xuất kết quả điểm rèn luyện đã được khoa duyệt của một đợt/lớp:

| Increment | Đầu ra | Tài liệu |
| --- | --- | --- |
| 10.1 | Snapshot REPEATABLE READ theo quyền, kiểm quyền lại | [ADR 0021](adr/0021-training-point-export-snapshot.md) |
| 10.2 | Excel hai sheet, POST tải, audit sau render | [ADR 0022](adr/0022-training-point-xlsx-download.md), [hướng dẫn](sprint-10-xlsx.md) |
| 10.3 | Biên bản `training-minutes-v1` Word/PDF, PDF từ đúng Word | [ADR 0023](adr/0023-training-minutes-docx-pdf.md), [hướng dẫn](sprint-10-minutes.md) |
| 10.4 | ZIP một snapshot + manifest, CORS, panel tải | [ADR 0024](adr/0024-training-export-bundle-and-download-ui.md), [hướng dẫn](sprint-10-export-ui.md) |
| 10.5 | Diễn tập trình duyệt, ca ngắt kết nối, runbook, hồ sơ đóng | Tài liệu này, [runbook](sprint-10-runbook.md) |

Điểm tự kê khai và điểm khoa duyệt tách riêng (diễn tập: 15 và 14); bản chưa duyệt chỉ nằm trong thống kê. Bộ A–E là giả định, không suy xếp loại. Xác nhận bằng tài khoản vẫn NOT_VERIFIED, `legalEffect=false`; mọi tệp mang nhãn “DỮ LIỆU THỬ NGHIỆM — CHƯA PHẢI BIỂU MẪU CHÍNH THỨC”, chỗ ký trên giấy để trống.

## Đối chiếu các ca kiểm chứng bắt buộc của plan

| Ca | Bằng chứng |
| --- | --- |
| 1. Session, role, permission, scope, phân công, thu hồi giữa lúc sinh/tải | HTTP/SQL 10.1–10.4 (thu hồi sau render/chuyển đổi không trả byte); diễn tập: ngoài phạm vi 404, sinh viên 403, hết phiên xóa dữ liệu |
| 2. Trống/chờ/đã duyệt, 0 và chưa có điểm, chuyển lớp, tên dài | Repository 10.1; unit DOCX/XLSX; PDF 120 dòng tên dài (10.3) |
| 3. Khoa duyệt đồng thời lúc xuất | Repository 10.1 (hàng và thống kê cùng snapshot); ZIP lấy một snapshot (10.4) |
| 4. Chuỗi công thức, số 0 đầu, ký tự đặc biệt | Unit XLSX 10.2 và DOCX 10.3; tên tệp chỉ từ UUID |
| 5. Converter thiếu/lỗi/quá thời gian, tác vụ lớn, khách ngắt kết nối | Ánh xạ lỗi converter (unit, HTTP); giới hạn 1.000 dòng/dung lượng; **ca mới 10.5**: client hủy giữa lúc chuyển PDF, máy chủ vẫn ổn, slot được nhả, request sau đạt |
| 6. Mở/đối chiếu XLSX/DOCX/PDF/ZIP thật; trình duyệt 375–1440 px | Diễn tập trình duyệt bên dưới; rà PDF/XLSX tải về |

## Kiểm chứng ngày 02/11/2026

Môi trường: container Linux cloud, Node 22.23.4 (pin `.nvmrc` 22.23.2), PostgreSQL 17 test, LibreOffice, Poppler, Chromium Playwright có sẵn.

| Nhóm | Kết quả |
| --- | --- |
| Typecheck API/web, lint API, format, build API/web | Đạt |
| ADR gate | 51 đạt |
| Unit API | 6 discovery + 207 đạt, 2 bỏ qua (ca Windows; ca PDF thật opt-in — đã chạy riêng, đạt) |
| Integration API | 359 đạt (runner training-review 22: 21 ca con + 1 nhóm) |
| Storage/recovery/bundle/guard diễn tập | 315 đạt (thêm 3 guard Sprint 10) |
| Web | 154 đạt |

Tổng các nhóm trên: **1.092 đạt, 2 bỏ qua, 0 thất bại** trong lượt này. Không cộng với baseline 23/10.

### Diễn tập trình duyệt

Run cuối `2858ad81-023b-43da-9e2b-4e2fa7e486c4`: **PASS**, 8 nhóm kiểm tra, 8 kiểm tra responsive (2 trang × 4 độ rộng), 9 ảnh, không lỗi JavaScript. Mã nguồn sản phẩm là commit `e019148`; working tree khi chạy chỉ thêm checker/launcher/test (không đổi runtime API/web).

| Tệp tải qua trình duyệt | Snapshot | SHA-256 |
| --- | --- | --- |
| Excel | `475c4524-d0d9-4b3d-b31c-fed9a734e231` | `40f24b1d86da242b813ecf0a83e6e6522612395e3b6f8dfcfeba2d2ade57400b` |
| Word | `3c9c4764-93a5-418c-af63-9b97352491df` | `376441d9026bbe407927bb12827e0ab60441bef21e39c177dfb0228c92f364b5` |
| PDF | `543cd13d-63e5-47b1-a532-6a87f7f6d2f7` | `dbbb1691912d507cf2115fd96014149ceae481e8d9f830e71ababf05ae312a92` |
| ZIP | `c3ee2603-639d-46e4-a7d0-3ce4e7382833` | `eb30bdcfe599a3b9febdf6e724346205fdb2bb1f4d660f9a638cc8e126ff526d` |

`browser-report.json`: `dd36c218c6297cd5f91769c8a7c338d2d4e5a93396965eddf6fd481754d6b58c`. Đã xem trực tiếp ảnh 375 px sau khi tải và ảnh hết phiên; PDF tải về 3 trang A4 ngang, bảng có một hàng (tự khai 15, duyệt 14); Excel đọc lại có đúng một hàng kết quả.

Diễn tập Sprint 9 chạy lại trên cùng code: **PASS**, 14 nhóm, 17 ảnh — luồng xét duyệt được bảo toàn.

## Lỗi phát hiện trong 10.5

- Assertion “hết phiên xóa dữ liệu” bản đầu luôn đúng (tìm `h3` bên trong đoạn text thay vì tên sinh viên trong `h3`). Run `209ed71e-ca11-42a7-a509-2d32c39a948b` PASS với assertion lỏng; đã sửa để kiểm từng tên sinh viên hiển thị trước đó và chạy lại (run cuối ở trên). Giữ run cũ để truy vết.
- Hai run Sprint 9 đầu tiên thất bại do môi trường (Docker chưa chạy; thiếu đường dẫn Playwright/Chromium), không phải lỗi sản phẩm; runbook ghi cách xử lý.

## Giới hạn còn lại (không chặn đóng local)

- **Microsoft Word/Excel desktop chưa kiểm**; font Times New Roman được thay bằng Liberation Serif trong container.
- CI chưa có LibreOffice và Chromium; ca PDF thật và diễn tập trình duyệt chạy thủ công.
- Header trang vẫn hiển thị tên tài khoản sau khi phiên hết hạn đến khi tải lại trang — hành vi chung của layout, có từ trước Sprint 10.
- Concurrency/rate limit theo instance; chưa có hủy yêu cầu từ giao diện.
- Bằng chứng `run/` là local, không commit; máy khác cần chạy lại theo runbook.
- Mẫu biên bản chính thức, chữ ký số, xếp loại, triển khai production và UAT cơ quan thuộc mốc sau. Giấy xác nhận sinh viên vẫn OFFLINE tại CTSV.
