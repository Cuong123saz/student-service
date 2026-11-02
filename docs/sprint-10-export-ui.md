# Sprint 10.4 — Gói ZIP và giao diện tải kết quả

**COMPLETE_LOCAL ngày 02/11/2026.** Quyết định: [ADR 0024](adr/0024-training-export-bundle-and-download-ui.md). Tiền đề: [Excel 10.2](sprint-10-xlsx.md), [biên bản 10.3](sprint-10-minutes.md). Sprint 10 chưa đóng (còn 10.5); production NOT_READY.

## Sử dụng

Trên web: đăng nhập cổng người dùng bằng tài khoản cố vấn/cán bộ khoa → **Xét duyệt điểm rèn luyện** → chọn đợt và lớp → panel **Xuất kết quả** dưới phần tổng hợp. Chọn Excel, Word, PDF hoặc gói ZIP.

API gói:

```http
POST /api/v1/user/training-reviews/periods/{periodId}/export.zip
Cookie: user_session=…
Origin: <CORS_ORIGIN>
Content-Type: application/json

{}
```

Thành công trả `application/zip` gồm `manifest.json`, `training-points-<snapshotId>.xlsx`, `training-minutes-<snapshotId>.docx`, `training-minutes-<snapshotId>.pdf`; header `X-Export-Snapshot-Id`, `X-Export-Sha256`, `X-Export-Template-Version`, `X-Export-Manifest-Sha256`. Mã lỗi giống [biên bản](sprint-10-minutes.md); PDF lỗi thì cả gói trả 503.

Tự đối chiếu gói sau khi tải:

```bash
unzip training-export-<snapshotId>.zip -d export && cd export && sha256sum *.xlsx *.docx *.pdf
```

So các hash với mục `files[].sha256` trong `manifest.json`.

## Kiểm chứng ngày 02/11/2026

Môi trường như 10.3: container Linux, Node 22.23.4, PostgreSQL 17 test, LibreOffice và Poppler.

| Kiểm tra | Kết quả |
| --- | --- |
| Unit API mới | 2 ca bundle, 2 ca service ZIP (một snapshot, PDF từ DOCX trong gói, audit một lần; PDF lỗi → cả gói lỗi, không audit, nhả slot) |
| HTTP/SQL mới | 1 ca: ZIP 200, CORS expose header, manifest khớp từng tệp, DOCX/XLSX trong gói cùng snapshot, audit metadata chính xác, PDF lỗi 503 không thêm audit |
| Web unit mới | 4 ca helper (tên tệp chỉ từ UUID, endpoint, SHA-256 hợp lệ, vector chuẩn SHA-256 `abc`) |
| Web acceptance mới | 3 ca panel: xem trước số lượng, chặn bấm đôi, hiện snapshot/hash; 503 giữ dữ liệu lớp; 403 xóa mọi hàng và danh sách đợt |
| ZIP thật với LibreOffice (fixture) | `sha256sum` khớp header/audit; 3 tệp khớp manifest; PDF 3 trang mang đúng mã snapshot |

Số tổng các bộ test sau thay đổi được ghi trong [trạng thái Sprint 10](sprint-10-status.json).

## Giới hạn còn lại

- **Chưa diễn tập trên trình duyệt thật** (CORS thật, Web Crypto, lưu tệp, 375/768/1024/1440 px). Acceptance test chạy trong môi trường Nuxt giả lập. Việc này thuộc 10.5.
- Chưa có hủy yêu cầu đang chạy; PDF/ZIP có thể mất vài chục giây.
- Số lượng xem trước lấy từ thống kê lúc tải trang, có thể khác snapshot khi tải; giao diện ghi rõ điều này.
- Giới hạn concurrency/rate limit theo instance. CI chưa có LibreOffice, nên ca HTTP/SQL dùng converter giả.
