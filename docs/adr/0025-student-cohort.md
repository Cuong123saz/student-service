---
status: Proposed
date: 2026-11-02
scope: Sprint 11.0 student cohort (niên khóa) for activity eligibility
---

# ADR 0025 — Niên khóa của sinh viên

**Proposed — chờ chủ dự án duyệt trước khi tạo migration.** Phục vụ [kế hoạch Sprint 11](../sprint-11-plan.md): hoạt động ngoại khóa có thể giới hạn theo niên khóa (ví dụ chỉ K2022).

## Bối cảnh

`student_profiles` hiện chỉ có `student_code` và `class_id`. Không có thông tin niên khóa hay năm nhập học, nên hệ thống không thể biết sinh viên thuộc niên khóa nào. “Sinh viên năm 4” là giá trị thay đổi theo thời gian và không đúng với sinh viên học chậm, nên không được lưu.

## Quyết định

- Thêm cột `cohort_year smallint NULL` vào `student_profiles`: năm bắt đầu của niên khóa (2022 nghĩa là K2022). Ràng buộc `CHECK (cohort_year BETWEEN 2000 AND 2100)`. Hiển thị dạng “K2022”.
- **Lưu theo sinh viên, không theo lớp.** Sinh viên học lại hoặc chuyển lớp vẫn giữ đúng niên khóa.
- **Không suy niên khóa** từ mã sinh viên, mã lớp hay năm học. Dữ liệu cũ để `NULL`.
- **Thiếu dữ liệu thì từ chối:** sinh viên `cohort_year IS NULL` không thuộc đối tượng của hoạt động có điều kiện niên khóa. Hoạt động không giới hạn niên khóa không bị ảnh hưởng.
- **Import Excel/CSV (Sprint 3)** nhận thêm cột tùy chọn **“Niên khóa”**, giá trị `2022` hoặc `K2022`. Tên cột chấp nhận (sau khi parser bỏ dấu, chuyển chữ thường): `nienkhoa` (“Niên khóa”, tên chính trong mẫu), `khoahoc` (“Khóa học”), `namnhaphoc` (“Năm nhập học”), `cohort`, `cohortyear`. **Không nhận `khoa`**: parser bỏ dấu nên “Khóa” và “Khoa” (đơn vị đào tạo) trùng nhau thành `khoa`; nhận alias này sẽ hiểu nhầm cột khoa thành niên khóa. Tệp có cột tên “Khóa” sẽ được báo lỗi tiêu đề kèm gợi ý đổi thành “Niên khóa”. Giá trị sai báo lỗi theo dòng như các cột hiện có. Cột trống giữ `NULL`; không ghi đè niên khóa đã có bằng giá trị trống.
- Thay đổi niên khóa của sinh viên ghi audit (giá trị cũ → mới, actor). Hồ sơ cá nhân và trang quản trị sinh viên hiển thị niên khóa.
- Snapshot sinh viên trong bản kê khai điểm rèn luyện (Sprint 8) **không** đổi. Đối tượng hoạt động được chốt riêng tại lúc đăng ký (ADR của 11.2–11.3).

## Migration và bảo toàn

Một migration mới chỉ `ALTER TABLE student_profiles ADD COLUMN cohort_year smallint` + CHECK. Không sửa migration cũ, không cập nhật dữ liệu có sẵn. Thêm ánh xạ `student_profiles → docs/adr/0025-student-cohort.md` vào ADR gate cho các migration sau. Kiểm chứng: migrate trên DB test giả riêng, hàng cũ giữ nguyên với `NULL`, rollback logic không cần vì cột nullable và chưa có dữ liệu.

## Phương án đã loại

- **Niên khóa theo lớp:** sai với sinh viên học lại/chuyển lớp.
- **Lưu “năm thứ”:** thay đổi mỗi năm học, cần job cập nhật, sai với sinh viên học chậm.
- **Suy từ mã sinh viên:** quy ước mã không được chốt bằng văn bản; đoán dữ liệu dẫn tới sai phân quyền.

## Kiểm chứng dự kiến

Unit parser (cột Niên khóa: hợp lệ, `K2022`, sai định dạng, ngoài khoảng, trống). Integration: import preview/confirm ghi đúng, giá trị trống không ghi đè, audit thay đổi, migration trên DB giả giữ dữ liệu cũ. Web: hiển thị niên khóa trong hồ sơ và trang quản trị; preview import báo lỗi theo dòng.
