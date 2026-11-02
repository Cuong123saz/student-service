---
status: Accepted
date: 2026-11-02
scope: Sprint 10.3 versioned training-point minutes in DOCX and PDF
---

# ADR 0023 — Biên bản Word/PDF kết quả điểm rèn luyện

Tiếp tục ADR 0021 (snapshot) và ADR 0022 (Excel). Thêm hai endpoint cho session cổng user và Origin hợp lệ, body `{}`, cùng validation/rate limit với Excel:

- `POST /api/v1/user/training-reviews/periods/:id/minutes.docx`
- `POST /api/v1/user/training-reviews/periods/:id/minutes.pdf`

Quyền xuất giữ nguyên ADR 0021; SYSTEM_ADMIN không thay vai trò cố vấn/khoa. Không thêm schema, catalog permission hoặc migration. Không mở ở cổng admin.

## Mẫu có phiên bản sinh bằng code

Biên bản được sinh trực tiếp thành WordprocessingML bằng `fflate` (`training-export.docx.ts`), không dùng tệp `.docx` mẫu nhị phân. Lý do: bảng kết quả có số dòng thay đổi, cần lặp tiêu đề và cấm tách hàng; sinh XML có kiểm soát giúp mọi chuỗi không tin cậy chỉ là ký tự trong `w:t`, không có placeholder để chèn vào, không field/hyperlink/ảnh. Không thêm dependency.

Phiên bản mẫu là `training-minutes-v1` (`trainingMinutesTemplate`). Vì mẫu là code, phiên bản là hợp đồng: unit test ghim SHA-256 của các phần XML đã giải nén khi render fixture. Đổi bố cục bắt buộc tăng version và cập nhật pin cùng lúc; không được sửa âm thầm bố cục đã phát hành. Pin dựa trên XML chưa nén nên nâng cấp thư viện nén không làm hỏng test. Cùng một snapshot luôn sinh cùng byte DOCX (mtime ZIP cố định).

Nội dung: nhãn “DỮ LIỆU THỬ NGHIỆM — CHƯA PHẢI BIỂU MẪU CHÍNH THỨC” ở thân và header mọi trang; thông tin đợt/lớp/khoa, mã snapshot, thời điểm chốt (UTC+7 cố định, không phụ thuộc ICU), người xuất, phiên bản mẫu; thống kê; tiêu chí A–E (giả định); bảng kết quả chỉ gồm bản APPROVED với điểm tự khai và điểm duyệt tách cột; danh sách người đã xác nhận trong hệ thống; ghi chú nguồn dữ liệu; khối “Xác nhận trên giấy” để trống. Không chèn chữ ký, dấu, họ tên người ký hoặc xếp loại. Footer có mã snapshot, phiên bản mẫu và “Trang X / Y”.

Bố cục A4 ngang, lề 1,5 cm, font Times New Roman (máy không có font sẽ thay bằng font tương thích metric, ví dụ Liberation Serif trên Linux). Bảng `fixed layout`, hàng tiêu đề `tblHeader`, mọi hàng `cantSplit`. Không có bản duyệt thì in câu nêu rõ, không in bảng điểm 0.

Excel và Word dùng chung `assertTrainingExportSnapshot` (`training-export.integrity.ts`): snapshot sai tổng/trung bình/điểm nhóm hoặc quá 1.000 dòng bị từ chối trước khi sinh byte.

## PDF từ đúng Word

PDF được chuyển từ chính buffer DOCX vừa sinh trong cùng request, qua `LibreOfficePdfConverter` đã có (thư mục tạm riêng 0600, profile riêng, timeout 90 giây, kill nhóm process, kiểm `%PDF-`/`%%EOF`, giới hạn 16 MiB, cách ly khi không chắc process đã dừng, dọn thư mục tạm). Audit và header `X-Export-Source-Docx-Sha256` ghi SHA-256 của DOCX nguồn để đối chiếu.

Lỗi converter được ánh xạ sang mã riêng của biên bản: `TRAINING_EXPORT_PDF_BUSY`, `TRAINING_EXPORT_PDF_QUARANTINED`, `TRAINING_EXPORT_PDF_UNAVAILABLE` (503). Không trả PDF rỗng hay một phần, không ghi audit, không lộ chi tiết lỗi nội bộ; người dùng vẫn tải được Word.

Converter của biên bản là một instance riêng, giới hạn 2 tác vụ; converter của hồ sơ thủ tục cũng có instance riêng. Trên một process có thể tới 4 tiến trình LibreOffice đồng thời. Gộp chung một converter cần refactor wiring của SubmissionService, để lại cho Sprint 13 nếu đo tải thấy cần.

## Quyền, audit và giới hạn

Giữ trình tự ADR 0022: đọc snapshot REPEATABLE READ READ ONLY → kiểm quyền ở transaction mới → sinh DOCX/chạy converter **ngoài transaction, không giữ khóa** → `recordExport` khóa SHARE, kiểm lại quyền hiện tại và ghi audit trong cùng transaction ngắn. Mất quyền/phân công trong lúc sinh hoặc chuyển đổi, hoặc lỗi audit, thì không trả byte.

Audit action là tập đóng `training.export.{xlsx,docx,pdf}.prepared`. Metadata DOCX: `snapshotId`, `rowCount`, `sha256`, `size`, `format`, `templateVersion`; PDF thêm `sourceDocxSha256`. Metadata XLSX giữ nguyên năm khóa của ADR 0022 (dùng `jsonb_strip_nulls`). Không ghi tên/điểm/nhận xét sinh viên hay storage key.

Một tác vụ xuất/tài khoản và hai tác vụ/instance, dùng chung cho Excel và biên bản. Rate limit 5 yêu cầu/phút/IP tính riêng theo từng route. Giới hạn byte: DOCX 8 MiB, PDF 16 MiB. Như ADR 0022, SUCCESS nghĩa là máy chủ đã chuẩn bị và cho phép trả, không chứng minh trình duyệt đã nhận; khách ngắt kết nối không dừng converter đang chạy, nhưng converter có timeout và luôn dọn tệp tạm.

Header thành công: `X-Export-Snapshot-Id`, `X-Export-Sha256`, `X-Export-Template-Version`, và với PDF `X-Export-Source-Docx-Sha256`. `private, no-store` kể cả lỗi, `nosniff`, attachment theo UUID snapshot. Việc expose các header này qua CORS cho UI thuộc 10.4.

## Ngoài phạm vi

Mỗi lần gọi Word hoặc PDF là một snapshot riêng; hai tệp tải riêng chỉ cùng nội dung khi cùng mã snapshot. Gói ZIP dùng một snapshot chung cho Excel/Word/PDF kèm manifest thuộc 10.4 và cần chốt riêng (bundle trong một request hay lưu snapshot). Mẫu chính thức của Học viện, chữ ký số và xếp loại không thuộc ADR này.

## Kiểm chứng

Unit: nội dung, tách điểm tự khai/điểm duyệt, số 0 thật, nhãn thử nghiệm, header lặp/cấm tách hàng, xác định và pin phiên bản, chuỗi không tin cậy (markup/field/công thức/placeholder/ký tự điều khiển), snapshot rỗng, snapshot sai/quá lớn; service: PDF từ đúng byte DOCX, ánh xạ lỗi converter, không audit khi lỗi, nhả slot, mất quyền sau render, slot chung với Excel. HTTP/SQL trên DB giả riêng: session/Origin/role/scope, GET không sinh tệp, header, audit metadata chính xác, lỗi converter 503 không lộ chi tiết, thu hồi phân công sau chuyển đổi không trả byte. Test PDF thật với LibreOffice là opt-in (`TRAINING_MINUTES_REAL_PDF=true`) vì CI chưa cài LibreOffice. Bố cục được rà bằng PDF render thật; xem [hướng dẫn biên bản](../sprint-10-minutes.md).
