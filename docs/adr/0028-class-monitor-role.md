---
status: Proposed
date: 2026-11-02
scope: Sprint 11.L class monitor (lớp trưởng) role, confirmation step and class roster
---

# ADR 0028 — Vai trò lớp trưởng

**Proposed ngày 02/11/2026.** Ghi các quyết định chủ dự án đã chốt; hai mục đánh dấu **[CHỜ]** cần chủ dự án xác nhận trước khi đổi sang Accepted và viết migration. Liên quan ADR 0020 (xét duyệt điểm rèn luyện), ADR 0027 (ngày sinh).

## Đã chốt

**Bổ nhiệm và nhiệm kỳ.** Lớp trưởng là role `CLASS_MONITOR` gán theo **lớp**, có ngày bắt đầu/kết thúc (giống phân công cố vấn). Hết nhiệm kỳ hoặc bị gỡ thì mất quyền ngay ở máy chủ. Một người có thể đồng thời là lớp trưởng và người phụ trách CLB; mỗi vai trò có phạm vi riêng.

**Bước lớp trưởng xác nhận phiếu điểm rèn luyện** (thêm vào quy trình ADR 0020):

```
Sinh viên nộp → Lớp trưởng xác nhận → Cố vấn xác nhận/trả về → Khoa duyệt/trả về
```

- Lớp trưởng **chỉ xác nhận đã kiểm tra** và có thể **ghi chú cho cố vấn**. Lớp trưởng **không sửa điểm** (cột “tập thể đánh giá” đã bỏ) và **không trả phiếu về sinh viên**; quyền trả về vẫn của cố vấn. Bản nộp của sinh viên vẫn bất biến.
- Quyết định mới `MONITOR_CONFIRMED` được nối vào lịch sử append-only; cần migration mở rộng CHECK của `training_review_decisions.action` và sửa ADR 0020.
- **Mặc định bắt buộc**: cố vấn chỉ thấy phiếu sau khi lớp trưởng xác nhận.
- **Phiếu của chính lớp trưởng** bỏ qua bước này, đi thẳng tới cố vấn. Không ai tự xác nhận phiếu của mình.
- Xác nhận bằng tài khoản là `NOT_VERIFIED`, `legalEffect=false`, không phải chữ ký số.

**Phiếu điểm rèn luyện cần “chữ ký” lớp trưởng.** Phiếu in (mẫu Học viện có ô ký Cố vấn / Lớp trưởng / Sinh viên) ghi “Lớp trưởng đã xác nhận trên hệ thống: {họ tên}, {thời điểm} (chưa phải chữ ký số)” và **vẫn để trống ô ký tay**. Bước xác nhận của lớp trưởng cho các thủ tục khác (cấu hình theo phiên bản biểu mẫu) để sau, khi có ví dụ thủ tục cụ thể.

**Audit.** Mọi thao tác của lớp trưởng (xác nhận, ghi chú, xem danh sách lớp, xem chi tiết phiếu, tải minh chứng) ghi audit. **Cố vấn của lớp** xem được audit các thao tác lớp trưởng trên lớp mình (trang mới ở cổng người dùng, chỉ lọc theo lớp được phân công).

## [CHỜ] 1 — “Cố vấn có quyền thay đổi” nghĩa là gì

Câu trả lời “ban đầu sẽ bắt buộc và cố vấn có quyền thay đổi” có thể hiểu theo ba cách:

1. Cố vấn **tắt/bật** bước lớp trưởng cho lớp mình.
2. Cố vấn **bổ nhiệm/thay** lớp trưởng.
3. Cố vấn **bỏ qua bước lớp trưởng cho từng phiếu** (kèm lý do, có audit), ví dụ khi lớp trưởng chậm.

Đề xuất: cho cả **(2)** và **(3)**. Như vậy lớp không bao giờ bị kẹt vì thiếu lớp trưởng, mà bước xác nhận vẫn mặc định bắt buộc.

## [CHỜ] 2 — Phạm vi dữ liệu lớp trưởng được xem

Chủ dự án muốn lớp trưởng **xem toàn bộ như cố vấn** để dễ liên lạc, có audit cố vấn xem được. Điều này **mâu thuẫn với ADR 0027 vừa được duyệt** (ngày sinh chỉ cho sinh viên đó, quản trị, cố vấn, khoa). Lớp trưởng là sinh viên ngang hàng; minh chứng có thể chứa giấy khám bệnh, hoàn cảnh gia đình.

Đề xuất tách theo mục đích:

| Dữ liệu | Lớp trưởng | Lý do |
| --- | --- | --- |
| Mã SV, họ tên, niên khóa, trạng thái phiếu | Xem | Tổng hợp phiếu |
| Email (liên lạc) | Xem | Mục đích liên lạc chủ dự án nêu |
| Điểm tự khai, giải trình từng mục | Xem | Cần để xác nhận phiếu |
| Minh chứng (tệp) | Xem/tải, mỗi lần tải ghi audit cố vấn xem được | Cần để kiểm phiếu; audit răn đe lạm dụng |
| Ngày sinh | **Không** | Không cần cho liên lạc hay xác nhận phiếu; giữ ADR 0027 |

Nếu chủ dự án vẫn muốn lớp trưởng xem cả ngày sinh, ADR 0027 phải được sửa và ghi rõ mục đích. Không làm ngầm.

## Phạm vi kỹ thuật dự kiến

- Migration: role/permission `CLASS_MONITOR`, bảng phân công lớp trưởng theo nhiệm kỳ, mở rộng CHECK hành động xét duyệt, cấu hình bắt buộc theo đợt; ánh xạ ADR gate.
- Hàm quyền SQL kiểu `training_review_allowed` cho giai đoạn `MONITOR`; hàng đợi cố vấn chỉ thấy phiếu đã qua lớp trưởng (hoặc được miễn).
- Bản xuất Sprint 10 (Excel/biên bản/bảng điểm lớp) thêm người/thời điểm lớp trưởng xác nhận; tăng phiên bản mẫu.
- Web: trang danh sách lớp và hàng đợi xác nhận cho lớp trưởng; trang audit lớp cho cố vấn.
- Test: hết nhiệm kỳ mất quyền, không tự xác nhận, lớp trưởng khác lớp bị chặn, cố vấn bỏ qua có lý do, audit đầy đủ, bảo toàn quyết định cũ của Sprint 9.
