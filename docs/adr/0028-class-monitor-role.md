---
status: Proposed
date: 2026-11-02
scope: Sprint 11.L class monitor (lớp trưởng) role, confirmation step and class roster
---

# ADR 0028 — Vai trò lớp trưởng

**Proposed ngày 02/11/2026.** Ghi các quyết định chủ dự án đã chốt; các mục đánh dấu **[CHỜ]** cần chủ dự án xác nhận trước khi đổi sang Accepted và viết migration. Liên quan ADR 0020 (xét duyệt điểm rèn luyện), ADR 0027 (ngày sinh).

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

## Phạm vi dữ liệu và quyền xuất của lớp trưởng (đã chốt 02/11/2026)

Chủ dự án quyết định lớp trưởng **xem được cả ngày sinh**, **in phiếu** và **tổng hợp bảng điểm** của lớp mình. Mục đích ghi nhận: lớp trưởng là người tổng hợp phiếu và lập bảng điểm lớp theo mẫu Học viện (bảng có cột Ngày sinh), đồng thời liên lạc với các bạn trong lớp.

| Dữ liệu / thao tác (chỉ lớp mình, trong nhiệm kỳ) | Lớp trưởng |
| --- | --- |
| Mã SV, họ tên, niên khóa, email, **ngày sinh**, trạng thái phiếu | Xem |
| Điểm tự khai, giải trình từng mục, minh chứng | Xem/tải |
| Phiếu đánh giá kết quả rèn luyện từng sinh viên | In (chức năng mới, xem dưới) |
| Bảng điểm lớp | Tổng hợp/tải |

- **Sửa đổi ADR 0027:** danh sách người được xem ngày sinh thêm **lớp trưởng của lớp, trong nhiệm kỳ**, với mục đích trên. Khi ADR 0027 đã vào `main`, ghi chú sửa đổi được thêm vào ADR 0027 để hai tài liệu không mâu thuẫn.
- **Bù lại bằng audit:** mọi lần lớp trưởng xem danh sách lớp, mở chi tiết phiếu, tải minh chứng, in phiếu hoặc tải bảng điểm đều ghi audit (không ghi giá trị ngày sinh hay nội dung phiếu). Cố vấn của lớp xem được các bản ghi này.
- Lớp trưởng **không** xem lớp khác, không xem sau khi hết nhiệm kỳ, không có quyền ở cổng quản trị.

**Chức năng mới cần làm:**

1. **In phiếu đánh giá kết quả rèn luyện từng sinh viên** theo mẫu Học viện (DOCX/PDF): thông tin sinh viên (gồm ngày sinh, niên khóa), điểm tự khai và điểm duyệt theo 5 mục, ô ký Cố vấn / Lớp trưởng / Sinh viên để trống, ghi chú các xác nhận trên hệ thống. Chỉ chấm theo 5 mục lớn (mục con chưa được mô hình hóa, ADR 0026). Cố vấn/khoa cũng in được.
2. **Tổng hợp trước khi duyệt:** bảng điểm lớp hiện chỉ liệt kê bản **khoa đã duyệt** (ADR 0026). Lớp trưởng tổng hợp ở đầu quy trình nên cần **[CHỜ]** chốt: thêm bản “bảng tổng hợp điểm tự khai” (ghi rõ “chưa được duyệt”), hay lớp trưởng chỉ tải bảng điểm sau khi khoa duyệt.

## Phạm vi kỹ thuật dự kiến

- Migration: role/permission `CLASS_MONITOR`, bảng phân công lớp trưởng theo nhiệm kỳ, mở rộng CHECK hành động xét duyệt, cấu hình bắt buộc theo đợt; ánh xạ ADR gate.
- Hàm quyền SQL kiểu `training_review_allowed` cho giai đoạn `MONITOR`; hàng đợi cố vấn chỉ thấy phiếu đã qua lớp trưởng (hoặc được miễn).
- Bản xuất Sprint 10 (Excel/biên bản/bảng điểm lớp) thêm người/thời điểm lớp trưởng xác nhận; tăng phiên bản mẫu.
- Web: trang danh sách lớp và hàng đợi xác nhận cho lớp trưởng; trang audit lớp cho cố vấn.
- Test: hết nhiệm kỳ mất quyền, không tự xác nhận, lớp trưởng khác lớp bị chặn, cố vấn bỏ qua có lý do, audit đầy đủ, bảo toàn quyết định cũ của Sprint 9.
