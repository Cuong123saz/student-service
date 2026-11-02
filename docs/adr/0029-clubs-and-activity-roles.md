---
status: Accepted
date: 2026-11-02
scope: Sprint 11.1 clubs (CLB) as organizational units and the roles CTSV, Phòng Đào tạo, club leader
---

# ADR 0029 — CLB và vai trò ngoại khóa

**Accepted ngày 02/11/2026** dựa trên [kế hoạch Sprint 11](../sprint-11-plan.md) đã được chủ dự án duyệt (“đồng ý hết”) và các trao đổi cùng ngày. Các mục ghi **Giả định** là lựa chọn mặc định của nhóm kỹ thuật; chủ dự án đổi được bằng amendment trước 11.6. Liên quan ADR 0025 (niên khóa), ADR 0028 (lớp trưởng).

## Bối cảnh

Sprint 11 cần ba actor mới: CTSV quản lý CLB và hoạt động bắt buộc, Phòng Đào tạo tạo hoạt động bắt buộc, người phụ trách CLB mở hoạt động tự nguyện. Hệ thống đã có `organizational_units` và scope `ORGANIZATION`, nhưng đơn vị chỉ có `ACTIVE/INACTIVE`, chưa có vòng đời CLB và chưa có nhiệm kỳ người phụ trách.

## Quyết định

**CLB là một đơn vị tổ chức.** Mỗi CLB là một dòng `organizational_units` cộng một dòng `clubs` 1–1 (`organizational_unit_id` UNIQUE). Bảng `clubs` giữ thông tin riêng (mô tả, trạng thái, người tạo, lý do đổi trạng thái). Không đổi CHECK `organizational_units.status` vì nhiều truy vấn cũ đang dựa vào `ACTIVE`.

**Vòng đời CLB:** `ACTIVE` → `SUSPENDED` (tạm dừng, mở lại được) → `DISSOLVED` (giải thể, cuối cùng).

- Chỉ CTSV tạo, sửa, tạm dừng, mở lại, giải thể. Đổi trạng thái bắt buộc ghi lý do.
- Sprint 11 chỉ tạo CLB **sau khi đã duyệt bên ngoài hệ thống**; chưa có luồng sinh viên đề nghị lập CLB.
- `SUSPENDED`/`DISSOLVED`: không mở hoạt động mới (kiểm ở 11.2). Chứng nhận đã cấp giữ nguyên.
- `DISSOLVED` đặt đơn vị tổ chức thành `INACTIVE` và kết thúc mọi nhiệm kỳ người phụ trách.

**Vai trò mới** (role hệ thống, quyền kiểm tại máy chủ):

| Role | Scope | Quyền ở 11.1 |
| --- | --- | --- |
| `STUDENT_AFFAIRS` — CTSV | `GLOBAL` | `club.read`, `club.manage` |
| `TRAINING_OFFICE` — Phòng Đào tạo | `GLOBAL` hoặc `FACULTY` | `club.read` |
| `CLUB_LEADER` — người phụ trách CLB | theo nhiệm kỳ (như `CLASS_MONITOR`), không gán scope bằng trang quản trị | `club.read` (chỉ CLB mình) |

- CTSV và Phòng Đào tạo được quản trị nghiệp vụ gán như các role khác. Quyền tạo hoạt động bắt buộc/tự nguyện, giao CLB, duyệt hủy và điểm danh thuộc ADR của 11.2–11.4.
- **SYSTEM_ADMIN không được cấp `club.manage`.** SYSTEM_ADMIN gán role cho người, không tự làm thay CTSV.

**Người phụ trách CLB theo nhiệm kỳ.** Bảng `club_leader_assignments` (người, CLB, `valid_from`, `valid_to`, `ACTIVE/INACTIVE`, người gán). CTSV gán và kết thúc nhiệm kỳ; việc gán tự thêm role `CLUB_LEADER`. Quyền của người phụ trách luôn kiểm qua nhiệm kỳ đang hiệu lực của **đúng CLB** và CLB `ACTIVE`; hết nhiệm kỳ thì mất quyền ngay.

- **Giả định:** một CLB có thể có nhiều người phụ trách cùng lúc (chủ nhiệm, phó chủ nhiệm).
- **Giả định:** người phụ trách là tài khoản người dùng đang hoạt động bất kỳ (sinh viên hoặc cán bộ), vì có CLB do cán bộ phụ trách.
- Một người có thể vừa là lớp trưởng vừa phụ trách CLB; mỗi vai trò có phạm vi riêng.

**Không tự duyệt.** Ràng buộc “không tự duyệt lượt tham gia/yêu cầu của chính mình” được ép ở 11.3–11.4. ADR này chỉ bảo đảm danh tính người phụ trách có thể kiểm được.

**Audit.** Ghi audit cho các sự kiện sau, kèm trạng thái trước/sau và lý do:

- `club.created`, `club.updated`, `club.suspended`, `club.resumed`, `club.dissolved`;
- `club.leader.assigned`, `club.leader.ended`.

## Hệ quả

- Migration viết tay: thêm role/permission, bảng `clubs` và `club_leader_assignments`. ADR gate ánh xạ cả hai bảng tới ADR này.
- Trang quản trị CLB cho CTSV ở cổng người dùng (CTSV là cán bộ nghiệp vụ, không phải tài khoản admin hệ thống).
- ADR 0028 ghi “CTSV cũng bổ nhiệm được lớp trưởng”. Việc này làm khi có role `STUDENT_AFFAIRS`, không chặn 11.1.

## Ngoài phạm vi

Luồng đề nghị lập CLB; danh sách thành viên CLB (tham gia hoạt động được tính qua chứng nhận ở 11.4); ban tổ chức theo từng hoạt động (11.2/11.5).
