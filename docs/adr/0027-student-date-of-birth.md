---
status: Accepted
date: 2026-11-02
scope: Student date of birth for the class sheet and procedure-form autofill
---

# ADR 0027 — Ngày sinh của sinh viên

**Accepted ngày 02/11/2026.** Chủ dự án đồng ý các đề xuất về quyền xem/sửa và bổ sung mục đích: ngày sinh được dùng để **tự điền vào biểu mẫu thủ tục** cần ngày sinh, và cho cột “Ngày sinh” của bảng điểm lớp theo mẫu Học viện (ADR 0026, việc D).

## Bối cảnh

Ngày sinh là dữ liệu cá nhân (theo hiểu biết hiện tại, thuộc phạm vi Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân; cần đối chiếu khi triển khai thật). Chỉ lưu và hiển thị ở nơi có mục đích rõ ràng.

## Quyết định

**Lưu trữ.** Cột `student_profiles.date_of_birth date NULL`, `CHECK` từ 1900-01-01 đến 2099-12-31. Ứng dụng kiểm thêm: không ở tương lai, không trước 1940-01-01. Dữ liệu cũ để `NULL`; không suy đoán từ mã sinh viên hay nguồn khác.

**Nhập liệu.** Import Excel/CSV (Sprint 3) nhận cột tùy chọn “Ngày sinh” (`ngaysinh`, `dateofbirth`, `birthdate`, `dob`):

- Ô kiểu ngày của Excel: lấy **ngày theo UTC** của giá trị đọc được (thư viện đọc ô ngày thành mốc 00:00 UTC). Không dùng giờ địa phương để tránh lệch một ngày.
- Chữ: `dd/mm/yyyy` hoặc `d/m/yyyy` (**luôn hiểu theo quy ước Việt Nam ngày/tháng**) hoặc `yyyy-mm-dd`. Ngày không tồn tại (30/02) bị báo lỗi theo dòng.
- Số trơn (serial Excel không có định dạng ngày) bị từ chối vì không chắc là ngày.
- Ô trống không xóa ngày sinh đã có. Chỉ quản trị có quyền import sửa được; sinh viên không tự sửa.

**Xem.** Sinh viên xem của chính mình trên hồ sơ. Quản trị xem trong danh sách sinh viên theo phạm vi hiện có. Cố vấn/khoa thấy trong bảng điểm lớp theo quyền xuất hiện có (ADR 0021). Không hiển thị ở trang công khai, danh sách xét duyệt hay thông báo.

**Audit và log.** Thay đổi ngày sinh ghi audit `STUDENT_DOB_UPDATE` **không kèm giá trị** (`before`/`after` chỉ ghi `{ "dateOfBirthSet": true|false }`). Ngày sinh không được đưa vào log, metadata audit hay thông báo lỗi.

**Tự điền biểu mẫu thủ tục.** Thêm `profileKey: 'dateOfBirth'`. Trường tự điền từ hồ sơ hiện chỉ cho kiểu TEXT; riêng `dateOfBirth` **bắt buộc kiểu DATE**. Khi sinh viên nộp hồ sơ, ảnh chụp thông tin sinh viên (bất biến) **chỉ chứa ngày sinh nếu phiên bản biểu mẫu có trường dùng `dateOfBirth`** (tối thiểu hóa dữ liệu). Phiếu Word của hồ sơ hiển thị `dd/mm/yyyy` như các trường ngày khác. Sinh viên chưa có ngày sinh thì trường hiện “Chưa kê khai”, không chặn nộp nếu trường không bắt buộc. Ảnh chụp của bản kê khai điểm rèn luyện (Sprint 8) không đổi.

**Bảng điểm lớp.** Mẫu tăng lên `class-sheet-v2`, thêm cột “Ngày sinh” (`dd/mm/yyyy`, chữ) sau “Họ và tên”, lấy từ hồ sơ **hiện tại** khi xuất (ngày sinh không đổi theo kỳ, khác tên/lớp lúc nộp). Thiếu ngày sinh thì để trống.

## Phương án đã loại

- Chụp ngày sinh vào mọi bản nộp hồ sơ: lưu dư dữ liệu cá nhân vĩnh viễn ở nơi không cần.
- Ghi giá trị cũ/mới vào audit: audit được nhiều người xem hơn hồ sơ.
- Hiểu `03/04/2003` theo tháng/ngày: sai quy ước Việt Nam.

## Kiểm chứng dự kiến

Unit: đọc ngày (ô Excel, `dd/mm/yyyy`, `yyyy-mm-dd`, 30/02, tương lai, trước 1940, số trơn), mẫu bảng điểm lớp v2, kiểm hợp lệ trường `dateOfBirth` của biểu mẫu. Integration: migration giữ dữ liệu cũ, import ghi/không xóa, audit không có giá trị ngày sinh, hồ sơ trả đúng, ảnh chụp bản nộp có/không có ngày sinh theo biểu mẫu. Web: hiển thị hồ sơ/quản trị, chọn `dateOfBirth` trong cấu hình biểu mẫu.
