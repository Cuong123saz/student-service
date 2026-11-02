---
status: Accepted
date: 2026-11-02
scope: Sprint 11.2 extracurricular activities — kinds, ownership, delegation, eligibility, capacity, lifecycle
---

# ADR 0030 — Hoạt động ngoại khóa

**Accepted ngày 02/11/2026** theo [kế hoạch Sprint 11](../sprint-11-plan.md) đã được chủ dự án duyệt và các quyết định cùng ngày. Mục **Giả định** là lựa chọn mặc định của nhóm kỹ thuật, đổi được bằng amendment trước 11.6. Dựa trên ADR 0025 (niên khóa) và ADR 0029 (CLB và vai trò). Đăng ký, hủy, điểm danh và chứng nhận thuộc 11.3–11.4.

## Quyết định

**Hai loại hoạt động.**

| Loại | Ai tạo | Chủ hoạt động | Giao CLB |
| --- | --- | --- | --- |
| Bắt buộc (`MANDATORY`) | CTSV hoặc Phòng Đào tạo | Đơn vị tạo (`STUDENT_AFFAIRS` hoặc `TRAINING_OFFICE`) | Được: chủ hoạt động giao một CLB đang hoạt động thực hiện, rút lại bất cứ lúc nào; mỗi lần giao/rút ghi lịch sử |
| Tự nguyện (`VOLUNTARY`) | Người phụ trách CLB đang hoạt động, trong nhiệm kỳ | CLB đó | Không |

- Người phụ trách CLB **không đánh dấu được bắt buộc**. CLB được giao **không sửa** thời gian, đối tượng, sức chứa; quyền duyệt hủy/điểm danh của CLB được giao thuộc 11.3–11.4.
- Hoạt động tự nguyện **không cần duyệt trước**. CTSV xem mọi hoạt động, **tạm dừng/mở lại** bất kỳ hoạt động đã công bố (bắt buộc ghi lý do).
- Mọi cán bộ giữ role của đơn vị chủ quản lý được hoạt động của đơn vị (chủ là đơn vị, không phải cá nhân). Phòng Đào tạo phạm vi `FACULTY` chỉ tạo/sửa hoạt động có đối tượng giới hạn trong các khoa của mình.
- SYSTEM_ADMIN chỉ xem, không tạo/sửa/tạm dừng (như ADR 0029).

**Nhóm hoạt động** (để 11.5 gợi ý đúng mục của phiếu, ADR 0026):

| Mã | Ý nghĩa | Mục phiếu (11.5) |
| --- | --- | --- |
| `SCHOOL` | Hoạt động do Học viện tổ chức/điều động | III.3.1 |
| `CLUB_ACADEMIC` | CLB, học thuật, ngoại khóa | I.1.4a |
| `VOLUNTEER` | Hiến máu, tình nguyện, công tác xã hội | IV.4.5 |

**Đối tượng.** Ba điều kiện kết hợp bằng AND; danh sách trống nghĩa là không giới hạn:

- khoa;
- lớp;
- niên khóa (năm vào học, ADR 0025).

Sinh viên chưa có niên khóa không thuộc đối tượng của hoạt động giới hạn niên khóa. Điều kiện được kiểm **ở máy chủ** bằng một hàm SQL dùng chung cho xem (11.2), đăng ký và điểm danh (11.3–11.4).

- **Giả định:** chưa giới hạn theo “đơn vị” cho sinh viên, vì sinh viên chỉ gắn với lớp/khoa. Mỗi danh sách tối đa 50 mục.

**Sức chứa.** Số nguyên 1–100 000 hoặc không giới hạn. Ràng buộc với số đã đăng ký kiểm ở 11.3.

**Vòng đời.**

```
DRAFT → PUBLISHED ⇄ SUSPENDED (chỉ CTSV)
DRAFT/PUBLISHED/SUSPENDED → CANCELLED (chủ hoạt động, bắt buộc lý do; cuối cùng)
```

- Chỉ công bố khi giờ bắt đầu còn ở tương lai và (với tự nguyện) CLB còn `ACTIVE`. CLB tạm dừng/giải thể không tạo hoặc công bố hoạt động mới; hoạt động đã công bố giữ nguyên để CTSV xử lý.
- Sửa được trước giờ bắt đầu, khi chưa hủy. **Mọi thay đổi** (kể cả sau khi công bố) ghi lịch sử với giá trị trước/sau.
- Sinh viên chỉ thấy hoạt động `PUBLISHED`, chưa kết thúc và đúng đối tượng. Không thấy bản nháp, bị tạm dừng hay đã hủy.

**Lịch sử và audit.** Bảng `activity_events` append-only (trigger chặn sửa/xóa) ghi `revision`, thao tác, người làm, lý do, trước/sau. `audit_logs` ghi `activity.*` cho cùng thao tác. Bảng `activities` có `revision` tăng mỗi lần đổi (khóa lạc quan).

## Hệ quả

- Migration viết tay:
  - permission `activity.read`, `activity.mandatory.manage`, `activity.moderate`, `activity.club.manage`;
  - bảng `activities`, `activity_events`;
  - hàm `activity_student_eligible`.
- ADR gate ánh xạ hai bảng tới ADR này.

## Ngoài phạm vi

Đăng ký, danh sách chờ, hủy (11.3); QR, ảnh, chứng nhận (11.4); ban tổ chức theo hoạt động và gợi ý điểm (11.5); lặp lịch định kỳ; tệp đính kèm hoạt động.
