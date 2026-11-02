---
status: Accepted
date: 2026-11-02
scope: Sprint 11.3 activity registration, capacity, waitlist, cancellation requests and absence
---

# ADR 0031 — Đăng ký hoạt động, danh sách chờ và hủy

**Accepted ngày 02/11/2026** theo [kế hoạch Sprint 11](../sprint-11-plan.md) và các quyết định của chủ dự án cùng ngày. Mục **Giả định** là lựa chọn mặc định của nhóm kỹ thuật, đổi được bằng amendment trước 11.6. Dựa trên ADR 0030.

## Đã chốt (từ chủ dự án)

- Có sức chứa hoặc không giới hạn, có danh sách chờ. Khi chỗ được nhả, người đầu danh sách chờ (theo thời điểm đăng ký) **tự lên** và được báo.
- Cả hoạt động bắt buộc và tự nguyện: sinh viên gửi **yêu cầu hủy trước giờ bắt đầu ít nhất 24 giờ, kèm lý do**. Chủ hoạt động (hoặc CLB được giao) chấp nhận/từ chối. Chấp nhận thì nhả chỗ. Yêu cầu chưa xử lý tới giờ bắt đầu **tự coi là chấp nhận**.
- Hủy được chấp nhận ở hoạt động bắt buộc được tính như đã tham gia khi gợi ý điểm (11.5), nên lưu cờ `excused`.
- Người đã đăng ký mà không có lượt tham gia được duyệt có trạng thái **Vắng**, khác “không đăng ký” và “hủy được duyệt”; chưa phạt.
- Đối tượng được chốt và lưu **snapshot tại lúc đăng ký**.

## Quyết định kỹ thuật

**Một dòng mỗi sinh viên mỗi hoạt động.** Bảng `activity_registrations` có UNIQUE (hoạt động, sinh viên). Trạng thái:

| Trạng thái | Giữ chỗ | Ý nghĩa |
| --- | --- | --- |
| `REGISTERED` | Có | Đã có chỗ |
| `WAITLISTED` | Không | Trong danh sách chờ, thứ tự theo `queued_at` |
| `CANCEL_REQUESTED` | Có | Đã gửi yêu cầu hủy, chờ chủ hoạt động |
| `CANCELLED` | Không | Hủy được chấp nhận (thủ công hoặc tự động); `excused=true` |
| `WITHDRAWN` | Không | Rút khỏi danh sách chờ |

- **Vắng** không lưu thành trạng thái. Nó được suy ra khi hoạt động đã kết thúc, dòng còn giữ chỗ và chưa có lượt tham gia được duyệt (lượt tham gia ở 11.4).
- Đăng ký chỉ khi hoạt động `PUBLISHED`, **trước giờ bắt đầu**, sinh viên đúng đối tượng (`activity_student_eligible`).
- **Giả định:** rút khỏi danh sách chờ có hiệu lực ngay, không cần duyệt, vì không giữ chỗ.
- **Giả định:** sau khi `CANCELLED`/`WITHDRAWN`, sinh viên được đăng ký lại nếu còn trước giờ bắt đầu. Khi đó xếp lại từ đầu theo thời điểm mới.

**Chống vượt sức chứa ở database.** Trigger trên `activity_registrations` khóa dòng hoạt động (`FOR UPDATE`) và từ chối mọi lần chuyển sang trạng thái giữ chỗ nếu số chỗ đang giữ vượt `capacity`. Ứng dụng cũng khóa dòng hoạt động trong transaction trước khi đếm, nên đăng ký đồng thời được xếp hàng tuần tự.

**Danh sách chờ tự lên** khi có chỗ:

- hủy được chấp nhận;
- tăng sức chứa;
- chuyển sang không giới hạn.

Chỉ tự lên trước giờ bắt đầu. Sau giờ bắt đầu, danh sách chờ giữ nguyên để làm dữ liệu.

**Báo khi được lên.**

- Ghi sự kiện `PROMOTED` vào lịch sử đăng ký.
- Hiện thông báo trên trang hoạt động của sinh viên cho tới khi sinh viên xác nhận đã xem (`promotion_seen_at`).
- **Giả định:** trung tâm thông báo hiện gắn với hồ sơ thủ tục (bảng `personal_notifications`), nên chưa đẩy vào đó. Sẽ hợp nhất khi mở rộng trung tâm thông báo, không đổi schema thông báo ở Sprint 11.

**Tự chấp nhận yêu cầu hủy quá hạn.** Hàm SQL `activity_settle(activity)` chuyển các `CANCEL_REQUESTED` thành `CANCELLED` (`auto_accepted=true`) khi đã tới giờ bắt đầu. Hàm được gọi trong mọi lần đọc/ghi đăng ký của hoạt động đó, không cần tiến trình nền.

**Người duyệt yêu cầu hủy.**

- Ai được duyệt: cán bộ của đơn vị chủ hoạt động, hoặc người phụ trách CLB chủ/được giao.
- **Không ai tự duyệt yêu cầu của chính mình.**
- Từ chối phải ghi lý do; chấp nhận được ghi chú.

**Sửa sức chứa.** Không giảm dưới số chỗ đang giữ (lỗi 400 rõ ràng), áp dụng trong luồng sửa hoạt động của ADR 0030.

**Lịch sử.** Bảng `activity_registration_events` append-only ghi mọi chuyển trạng thái, người làm (NULL khi hệ thống tự làm) và lý do. `audit_logs` ghi `activity.registration.*` cho thao tác của người duyệt.

## Ngoài phạm vi

Điểm danh và chứng nhận (11.4); phạt vắng mặt; đăng ký hộ; nhắc lịch qua email.
