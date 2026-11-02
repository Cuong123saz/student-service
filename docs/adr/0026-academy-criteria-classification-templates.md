---
status: Accepted
date: 2026-11-02
scope: Academy criteria preset, provisional classification and school-format class sheet/minutes
---

# ADR 0026 — Bộ tiêu chí Học viện, xếp loại tạm tính và mẫu xuất theo trường

**Accepted ngày 02/11/2026** theo yêu cầu chủ dự án (“làm A, B, C trước”), dựa trên ba tài liệu mẫu chủ dự án cung cấp: phiếu đánh giá kết quả rèn luyện, bảng điểm rèn luyện lớp (Excel) và biên bản họp lớp. Các tài liệu có dữ liệu cá nhân thật nên **không** được đưa vào repo; chỉ cấu trúc được dùng. Tiếp nối ADR 0019–0024. Không thêm migration.

## A — Bộ tiêu chí của Học viện

Phiếu có 5 mục, tổng 100 điểm. Hàm `training_valid_criteria` (Sprint 8) đã cho phép 5 nhóm A–E với điểm tối đa khác nhau miễn tổng bằng 100, nên không cần đổi schema. Mã nội bộ giữ A–E; nhãn hiển thị ghi số La Mã của phiếu:

| Mã | Nhãn | Tối đa |
| --- | --- | --- |
| A | I. Ý thức học tập | 20 |
| B | II. Ý thức chấp hành nội quy, quy chế, quy định trong Học viện | 25 |
| C | III. Tham gia hoạt động chính trị, xã hội, văn hóa, văn nghệ, thể thao, phòng chống tệ nạn xã hội | 20 |
| D | IV. Phẩm chất công dân và quan hệ với cộng đồng | 25 |
| E | V. Công tác phụ trách lớp, đoàn thể, tổ chức hoặc thành tích đặc biệt | 10 |

Bộ này nằm ở API (`academyCriteria`) và được catalog quản trị trả về làm mẫu `academy-assessment-form-v1`; form tạo đợt dùng mẫu này thay cho bộ giả định. Quản trị vẫn sửa được trước khi mở đợt; đợt đã có giữ nguyên tiêu chí của nó. Chỉ chấm theo 5 mục lớn; **các mục con (1.1, 1.2…) chưa được mô hình hóa**. Cột “do tập thể đánh giá” trên phiếu đã bị trường bỏ, không làm.

## B — Xếp loại tạm tính

Mốc chuẩn (chủ dự án chấp nhận làm mốc hiện tại; cần đối chiếu quy chế Học viện), phiên bản `classification-standard-v1`:

| Xếp loại | Tổng điểm đã duyệt |
| --- | --- |
| Xuất sắc | 90–100 |
| Tốt | 80–89 |
| Khá | 65–79 |
| Trung bình | 50–64 |
| Yếu | 35–49 |
| Kém | 0–34 |

- Bảng mốc là **một hằng số duy nhất** (`training-classification.ts`), có phiên bản. Đổi mốc phải tăng phiên bản.
- Chỉ tính từ **điểm khoa đã duyệt**; bản chưa duyệt không có xếp loại.
- Gắn nhãn **“tạm tính”**: chưa áp dụng hạ mức do kỷ luật (khiển trách hạ 1 mức, cảnh cáo hạ 2 mức, đình chỉ không đánh giá) vì hệ thống chưa có dữ liệu kỷ luật.
- File Excel mẫu của trường dùng công thức chỉ có Xuất sắc/Tốt/Khá/“Yếu”, bỏ mất Trung bình và Kém (điểm 60 bị ghi “Yếu”). Hệ thống **không** sao chép lỗi này.
- Snapshot xuất (ADR 0021) đổi `classification` từ `NOT_ASSIGNED` sang đối tượng `{ status: 'PROVISIONAL', version }`. Xếp loại từng hàng và số lượng theo mức được **tính khi render** từ điểm đã duyệt bằng hàm thuần, không lưu thêm vào snapshot. Giá trị được ghi thành **chữ**, không phải công thức Excel.

## C — Mẫu xuất theo trường

**Bảng điểm lớp** (`POST .../periods/:id/class-sheet.xlsx`, mẫu `class-sheet-v1`): quốc hiệu và tên cơ quan, “Hà Nội, ngày … tháng … năm …”, tiêu đề “BẢNG ĐIỂM RÈN LUYỆN LỚP {lớp} HỌC KỲ {kỳ} NĂM HỌC {năm}”, “(Kèm theo Quyết định số: … ngày …)” để điền tay, cột STT / Mã sinh viên / Họ và tên / Tổng điểm / Xếp loại / Ghi chú, chỗ ký Cố vấn học tập và Lớp trưởng để trống. Chỉ liệt kê bản khoa đã duyệt; số bản chưa duyệt ghi ở dòng ghi chú cuối bảng. **Chưa có cột Ngày sinh** vì hệ thống chưa lưu ngày sinh (việc D, cần ADR riêng về dữ liệu cá nhân).

**Biên bản họp lớp** thay nội dung biên bản Word/PDF của Sprint 10, mẫu tăng lên `training-minutes-v2`. Biên bản ở section **A4 dọc** (như mẫu trường), phụ lục ở section **A4 ngang**: quốc hiệu, “BIÊN BẢN HỌP LỚP {lớp} KHOA {khoa}”, các mục Thời gian/địa điểm, Thành phần tham dự, Chủ tọa/thư ký và giờ kết thúc để **dòng chấm điền tay** (hệ thống không biết thông tin cuộc họp); nội dung “Đánh giá điểm rèn luyện học kỳ … năm học …”; diễn biến ghi tổng số bản kê khai đã nộp và đã duyệt; kết quả ghi số lượng theo 6 mức xếp loại; chỗ ký Thư ký và GV cố vấn học tập để trống. Bảng điểm chi tiết của v1 được giữ làm **phụ lục** cuối biên bản để biên bản và số liệu cùng một snapshot. Endpoint, quyền, audit, PDF từ đúng DOCX giữ nguyên ADR 0023.

Mọi tệp vẫn mang nhãn “DỮ LIỆU THỬ NGHIỆM — CHƯA PHẢI BIỂU MẪU CHÍNH THỨC” cho tới khi Học viện phê duyệt mẫu, mã snapshot ở chân trang, không chèn chữ ký/dấu. Gói ZIP (ADR 0024) thêm bảng điểm lớp, cùng snapshot, có trong manifest.

## Ảnh hưởng hợp đồng

- XLSX chi tiết (ADR 0022): thêm cột “Xếp loại (tạm tính)” sau “Tổng điểm duyệt”; sheet thông tin thay dòng “Chưa gán xếp loại” bằng phiên bản mốc và số lượng theo mức.
- Audit thêm `training.export.class-sheet.prepared`; metadata giống XLSX cộng `templateVersion`.
- `training-minutes-v1` không còn được sinh; bản đã tải trước đó giữ nguyên giá trị (hash ghi trong audit cũ).

## Ngoài phạm vi

Mục con của phiếu; hạ mức do kỷ luật; ngày sinh; vai trò lớp trưởng (giữ trong kế hoạch, làm sau); phiếu đánh giá cá nhân từng sinh viên.
