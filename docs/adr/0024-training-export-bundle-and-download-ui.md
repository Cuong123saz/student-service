---
status: Accepted
date: 2026-11-02
scope: Sprint 10.4 single-snapshot ZIP bundle, CORS-exposed export headers and download UI
---

# ADR 0024 — Gói ZIP một snapshot và giao diện tải kết quả điểm rèn luyện

Tiếp tục ADR 0021–0023. Quyền xuất, Origin, validation, rate limit và trình tự “snapshot → kiểm quyền → render ngoài transaction → kiểm quyền + audit” giữ nguyên.

## Quyết định: bundle trong một request, không lưu snapshot

Thêm `POST /api/v1/user/training-reviews/periods/:id/export.zip`, body `{}`. Service đọc **một** snapshot, sinh Excel, DOCX, PDF (từ đúng DOCX đó), đóng gói kèm `manifest.json`, rồi kiểm quyền và ghi audit một lần.

Phương án lưu snapshot bền vững (bảng mới, tải từng tệp theo mã snapshot về sau) bị loại vì:

- Chưa có nhu cầu tải lại cùng snapshot sau thời điểm xuất; mỗi lần tải là một lần chốt dữ liệu mới, như ADR 0022.
- Lưu snapshot nghĩa là lưu thêm dữ liệu cá nhân và điểm, cần schema/migration, chính sách lưu giữ và kiểm quyền khi đọc lại; chi phí lớn hơn lợi ích hiện tại.
- Bundle trong một request đã bảo đảm yêu cầu cốt lõi: các tệp trong cùng gói đến từ cùng snapshot.

Không thêm schema, migration hoặc permission.

## Nội dung gói

`manifest.json` (schemaVersion 1) ghi `snapshotId`, `capturedAt`, `periodId`, `classCode`, số bản đã duyệt, `templateVersion`, danh sách tệp với MIME/kích thước/SHA-256, tên DOCX nguồn của PDF, `classification: NOT_ASSIGNED`, `technicalSignatureStatus: NOT_VERIFIED`, `legalEffect: false` và nhãn thử nghiệm. Manifest chỉ chứng minh toàn vẹn byte, không phải chữ ký số. Không gom minh chứng sinh viên vào gói.

Tệp Excel/Word/PDF được lưu không nén lại (đã là định dạng nén); manifest nén. mtime ZIP cố định nên cùng đầu vào cho cùng byte. Tên tệp trong gói dựa trên UUID snapshot. Tên trùng hoặc tệp đè `manifest.json` bị từ chối.

Bất kỳ phần nào lỗi (kể cả PDF) thì **cả gói** thất bại, không trả gói thiếu định dạng. Người dùng vẫn tải được từng tệp riêng. Giới hạn gói 32 MiB (8 + 8 + 16 MiB). Một tác vụ/tài khoản và hai tác vụ/instance dùng chung với các định dạng khác.

Audit `training.export.zip.prepared` ghi `snapshotId`, `rowCount`, `sha256` của ZIP, `size`, `format: ZIP`, `templateVersion`, `manifestSha256`. Header thêm `X-Export-Manifest-Sha256`.

## CORS

`@fastify/cors` thêm `exposedHeaders`: `Content-Disposition`, `X-Export-Snapshot-Id`, `X-Export-Sha256`, `X-Export-Template-Version`, `X-Export-Source-Docx-Sha256`, `X-Export-Manifest-Sha256`. Các giá trị là mã/hash, không chứa dữ liệu cá nhân. Origin vẫn chỉ là `CORS_ORIGIN` có credentials.

## Giao diện

Trang `/training-reviews` có panel `TrainingExportPanel` dưới phần tổng hợp lớp:

- Xem trước phạm vi (đợt, lớp, năm học, học kỳ) và số bản khoa đã duyệt từ thống kê lớp đang hiển thị; nói rõ bản chưa duyệt chỉ nằm trong thống kê, và số lượng có thể khác snapshot khi tải.
- Bốn nút `BaseButton`: Excel, Word, PDF, ZIP. Chỉ một tác vụ tại một thời điểm; nút đang chạy hiển thị trạng thái loading, các nút khác bị khóa.
- Composable gọi POST, đọc header, tính SHA-256 của Blob bằng Web Crypto và **chỉ lưu tệp khi khớp** `X-Export-Sha256`. Trình duyệt không có Web Crypto thì vẫn lưu nhưng ghi rõ chưa đối chiếu. Tên tệp chỉ dựng từ UUID snapshot hợp lệ.
- Thành công: hiện tên, dung lượng, mã snapshot, SHA-256 và nhắc rằng hash không phải chữ ký số. Lỗi: thông báo `role="alert"` được focus. 401/403/404 xóa danh sách đợt và mọi hàng sinh viên khỏi màn hình; lỗi khác (ví dụ 503 PDF) giữ dữ liệu lớp.

## Ngoài phạm vi

Hủy yêu cầu đang chạy từ trình duyệt, tải nền và thông báo khi xong. Diễn tập trình duyệt thật ở nhiều độ rộng và rà ZIP trên Windows thuộc 10.5. Cổng admin vẫn không có chức năng xuất.
