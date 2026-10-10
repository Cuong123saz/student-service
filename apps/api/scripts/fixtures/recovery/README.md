# Minh chứng giả đúng định dạng cho diễn tập phục hồi

Hai PDF một trang chỉ chứa dữ liệu giả, có nhãn `TEST DATA - NOT AN OFFICIAL DOCUMENT`, không có dấu hoặc chữ ký. Tên trường trên PDF dùng ASCII để giữ fixture nhỏ, không cần nhúng font; hồ sơ JSON dùng họ tên tiếng Việt `Nguyễn Minh An (giả định)` để kiểm tra giữ nguyên Unicode.

| Tệp                    | Dung lượng | Nội dung                         |
| ---------------------- | ---------- | -------------------------------- |
| `evidence-round-1.pdf` | 2.612 byte | Lần gửi 1; số 0 và boolean false |
| `evidence-round-2.pdf` | 2.606 byte | Lần gửi 2; số 15 và boolean true |

Tạo bằng ReportLab với Helvetica, A4, `invariant=1`, `pageCompression=0`. Ngày 10/10/2026 đã mở bằng `pypdf.PdfReader(path, strict=True)`: mỗi tệp đúng một trang, không mã hóa, không AcroForm, trích được nhãn dữ liệu giả và số lần gửi. Đã render bằng Poppler và xem cả hai trang, không lỗi bố cục. Hai tệp có nội dung khác nhau và đều dưới giới hạn 4.096 byte của cấu hình thủ tục giả.

`recovery-fixture.test.mjs` khóa SHA-256 của chính các byte đã kiểm tra độc lập, đồng thời đối chiếu metadata qua `inspectEvidence` của ứng dụng. SHA-256 không phải bộ phân tích PDF; khi thay fixture phải phân tích và render lại trước khi cập nhật hash. Thuộc tính Git `*.pdf binary` giữ nguyên byte PDF và offset xref khi checkout trên Windows/Linux. Node/CI dùng các PDF đã lưu trong Git, không cần Python/ReportLab/Poppler để chạy diễn tập.

Ứng dụng hiện nhận dạng loại tệp qua dấu đầu/cuối và tên/MIME; không phân tích đầy đủ cấu trúc PDF hoặc xác minh chữ ký số. Các PDF hợp lệ này cải thiện dữ liệu diễn tập, không thay đổi cơ chế kiểm tra upload.
