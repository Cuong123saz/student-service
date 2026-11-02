# Sprint 10 — Runbook diễn tập xuất kết quả điểm rèn luyện

Chỉ dùng **dữ liệu giả**. Bộ diễn tập tự tạo container PostgreSQL 17 riêng (tmpfs), seed tài khoản giả, chạy API tại `http://127.0.0.15:3038` và web tại `http://127.0.0.15:3039`, rồi chạy checker Playwright một lần. Không đọc `DATABASE_URL`/storage thật; có biến đó trong môi trường thì bộ diễn tập từ chối chạy.

## Điều kiện

- Docker đang chạy; cổng 3038/3039 trên `127.0.0.15` trống.
- Node theo `.nvmrc`; `npm ci` đã chạy.
- LibreOffice (`soffice` trên PATH hoặc `LIBREOFFICE_PATH`) để có PDF thật.
- Playwright + Chromium. Repo không cài Playwright; trỏ tới bản có sẵn trên máy bằng biến môi trường. Các biến khác bị lọc khi khởi chạy checker, nên phải truyền tường minh.

## Chạy

```bash
cd apps/api
```

```bash
WORKFLOW_PLAYWRIGHT_MODULE=/duong/dan/node_modules/playwright/index.js WORKFLOW_CHROMIUM_EXECUTABLE=/duong/dan/chromium npm run rehearse:sprint10
```

Khi checker xong, tiến trình tự dọn: dừng API/web và xóa container của lượt chạy. Dừng sớm từ terminal khác:

```bash
node scripts/workflow-demo.mjs --fake-data-only --sprint10 stop
```

## Checker kiểm gì

1. Quản trị giả tạo, mở rồi đóng đợt; hai sinh viên giả nộp, một bản được cố vấn xác nhận và khoa duyệt (tự khai 15, duyệt 14), một bản còn chờ.
2. Tài khoản ngoài phạm vi nhận 404, sinh viên nhận 403 khi gọi ZIP; khoa tải Excel được và hash khớp header.
3. Cố vấn mở `/training-reviews`: panel xem trước ghi “Sẽ xuất 1 bản khoa đã duyệt” và 1 bản chưa duyệt chỉ nằm trong thống kê. Ảnh 375/768/1024/1440 px, không tràn ngang, nút ≥ 44 px.
4. Tải lần lượt Excel, Word, PDF, ZIP qua nút giao diện: tên tệp theo UUID snapshot, SHA-256 hiển thị khớp tệp đã lưu, trình duyệt báo đã đối chiếu, mỗi lần tải là một snapshot khác nhau, ZIP có manifest khớp cả ba tệp.
5. Xóa cookie (giả lập hết phiên) rồi bấm tải: thông báo hết phiên, mọi tên sinh viên và danh sách đợt biến mất.
6. Không có lỗi JavaScript.

## Kết quả và cách đọc

Thư mục `run/workflow-demo/<runId>/` (không commit):

- `browser-report.json`: `status` PASS/FAIL, `phase` khi lỗi, `checks`, `downloads` (định dạng, tên, kích thước, SHA-256, snapshot), danh sách ảnh.
- `export-*.{xlsx,docx,pdf,zip}`, `zip-*.pdf`: tệp tải bằng trình duyệt.
- `*.png`: ảnh chụp, `api.log`, `web.log`, `sprint10-browser.log`.

Rà thủ công sau khi chạy:

```bash
pdftoppm -r 60 -png export-pdf.pdf trang
```

```bash
unzip export-zip.zip -d zip && cd zip && sha256sum *.xlsx *.docx *.pdf
```

So kết quả `sha256sum` với `manifest.json`.

## Khi lỗi

| Dấu hiệu | Xử lý |
| --- | --- |
| `WORKFLOW_DEMO_FAILED create-isolated-database WORKFLOW_DEMO_DOCKER_FAILED` | Docker chưa chạy |
| `Cannot find module 'playwright'` | Đặt `WORKFLOW_PLAYWRIGHT_MODULE` |
| `Executable doesn't exist` | Đặt `WORKFLOW_CHROMIUM_EXECUTABLE` |
| `WORKFLOW_DEMO_ALREADY_CHECKED` | Mỗi run chỉ kiểm một lần; chạy lượt mới |
| Phase `downloads` lỗi 503 | Kiểm LibreOffice; xem `api.log` |

Giữ nguyên thư mục của run lỗi để truy vết; không sửa `browser-report.json`.
