---
status: Accepted
date: 2026-11-02
scope: Sprint 11.5 per-period activity settings, organising committee and training point suggestions from certificates
---

# ADR 0033 — Gợi ý điểm rèn luyện từ hoạt động ngoại khóa

**Accepted ngày 02/11/2026** theo [kế hoạch Sprint 11](../sprint-11-plan.md), mục “Gợi ý điểm rèn luyện” (cập nhật cùng ngày theo phiếu đánh giá của Học viện, ADR 0026). Mục **Giả định** là lựa chọn mặc định của nhóm kỹ thuật, đổi được bằng amendment trước 11.6. Dựa trên ADR 0019/0020 (điểm rèn luyện), ADR 0030–0032.

## Đã chốt (từ chủ dự án)

| Loại hoạt động | Mục phiếu | Quy tắc mặc định |
| --- | --- | --- |
| Do Học viện tổ chức/điều động (`SCHOOL`) | III.3.1 (nhóm C) | **Đầy đủ** = có chứng nhận đủ mọi hoạt động bắt buộc thuộc đối tượng → **+3**; **tích cực** = đầy đủ và thêm hoạt động tự chọn → **+5**; thiếu bắt buộc → 0 |
| CLB, học thuật, ngoại khóa (`CLUB_ACADEMIC`) | I.1.4a (nhóm A) | Tham gia → **+3**; thành viên ban tổ chức → **+2** |
| Hiến máu, tình nguyện, xã hội (`VOLUNTEER`) | IV.4.5 (nhóm D) | Tham gia → **+5** |

- Hoạt động bắt buộc có hủy được chấp nhận (`excused`) được tính như đã tham gia.
- Kỳ không có hoạt động bắt buộc: có cho mức “đầy đủ” hay không là **cấu hình theo đợt**, mặc định **có** (B=0 vẫn +3, quyết định của chủ dự án).
- **Thiết lập theo đợt, không viết cứng**: nhóm nhận điểm, mức điểm, số hoạt động tự chọn tối thiểu cho mức tích cực, khoảng thời gian tính. Người quản lý đợt sửa, có kiểm hợp lệ và audit. Đổi thiết lập không sửa bản kê khai đã nộp.
- Chỉ là **gợi ý** kèm chứng nhận làm minh chứng; cố vấn và khoa vẫn duyệt như Sprint 9. Thu hồi chứng nhận không sửa ngược bản đã nộp hay điểm đã duyệt.

## Quyết định kỹ thuật

**Thiết lập theo đợt.** Bảng `training_activity_settings` có một dòng mỗi đợt (khóa là `period_id`), gồm cấu hình JSON, `revision` (khóa lạc quan) và người sửa. Đợt chưa có dòng thì dùng mặc định. Cấu hình gồm:

- `window`: khoảng thời gian `from`/`to`;
  - **Giả định:** học kỳ 1 tính từ 01/08 tới hết 31/01; học kỳ 2 từ 01/02 tới hết 31/07 (giờ Việt Nam), suy từ năm học và học kỳ của đợt.
- `school`: `{ group, full, active, minVoluntary, fullWithoutMandatory }`, mặc định `C`, 3, 5, 2, `true`;
  - **Giả định:** `minVoluntary=2`, theo trao đổi “bắt buộc + 2 hoạt động”.
- `club`: `{ group, participant, organizer }`, mặc định `A`, 3, 2;
- `volunteer`: `{ group, participant }`, mặc định `D`, 5.

Kiểm hợp lệ:

- nhóm phải có trong bộ tiêu chí của đợt;
- mỗi mức điểm từ 0 tới điểm tối đa của nhóm;
- `minVoluntary` từ 0 tới 20;
- `from < to`, khoảng không quá 400 ngày.

**Tính gợi ý (khi đọc, không lưu).** Chỉ xét hoạt động **đã kết thúc**, không bị hủy, có giờ bắt đầu trong khoảng `window`.

- *Bắt buộc thuộc đối tượng*:
  - gồm các hoạt động `MANDATORY` nhóm `SCHOOL` mà sinh viên thuộc đối tượng (hàm `activity_student_eligible` hiện tại), hoặc đã đăng ký;
  - mỗi hoạt động được tính là đủ khi có chứng nhận `ISSUED` hoặc đăng ký `excused`.
- *Tự chọn*: số chứng nhận `ISSUED` của hoạt động `VOLUNTARY` nhóm `SCHOOL`.
- *CLB*: có ít nhất một chứng nhận `ISSUED` nhóm `CLUB_ACADEMIC` → điểm tham gia. Là ban tổ chức của ít nhất một hoạt động `CLUB_ACADEMIC` → thêm điểm ban tổ chức.
- *Tình nguyện*: có ít nhất một chứng nhận `ISSUED` nhóm `VOLUNTEER` → điểm tham gia.
- Tổng gợi ý của mỗi nhóm **không vượt điểm tối đa** của nhóm đó.
- Mỗi dòng gợi ý trả về mã chứng nhận làm căn cứ.
- Chứng nhận đã thu hồi không còn được tính từ lần đọc sau.

**Ban tổ chức.** Bảng `activity_organizers` lưu (hoạt động, sinh viên, người thêm, thời điểm, `removed_at`).

- Ai sửa: chủ hoạt động hoặc CLB chủ/được giao. Thêm hoặc gỡ từ lúc công bố tới 30 ngày sau khi kết thúc (**giả định**). Mọi thay đổi ghi audit.
- Không ai tự thêm mình. Chỉ thêm được sinh viên đang hoạt động.

**Ai xem gợi ý.**

- Sinh viên xem gợi ý cho bản kê khai của mình. Nút “Điền gợi ý” chỉ điền vào **bản nháp trên trình duyệt**: điểm của nhóm là số lớn hơn giữa điểm hiện tại và điểm gợi ý (không vượt tối đa), kèm mã chứng nhận trong giải trình. Sinh viên vẫn tự lưu và nộp.
- Cố vấn, khoa và lớp trưởng có quyền xem bản kê khai thì xem cùng gợi ý, để đối chiếu.
- Gợi ý **không bao giờ** tự sửa bản kê khai hay điểm đã duyệt.

## Ngoài phạm vi

Chấm theo mục con của phiếu; tự động cộng điểm khi duyệt; phạt vắng mặt; xuất danh sách ban tổ chức.
