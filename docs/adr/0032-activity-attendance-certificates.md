---
status: Accepted
date: 2026-11-02
scope: Sprint 11.4 activity check-in (QR + in-page photo), attendance review and participation certificates
---

# ADR 0032 — Điểm danh hoạt động và chứng nhận tham gia

**Accepted ngày 02/11/2026** theo [kế hoạch Sprint 11](../sprint-11-plan.md) và các quyết định của chủ dự án cùng ngày. Mục **Giả định** là lựa chọn mặc định của nhóm kỹ thuật, đổi được bằng amendment trước 11.6. Dựa trên ADR 0030 và ADR 0031.

## Đã chốt (từ chủ dự án)

- **QR in sẵn, không đổi liên tục** để in cho mọi người quét. Tùy chọn **QR đổi liên tục trên màn hình** cho hoạt động muốn chặt hơn.
- Trong khoảng **giờ bắt đầu → kết thúc**, sinh viên quét QR bằng camera điện thoại. Trang portal mở **camera trước ngay trong trang** (không có nút chọn ảnh có sẵn) để chụp **selfie thấy hội trường hoặc đặc trưng** (ban giám khảo, sân khấu).
- Lượt tham gia **chờ duyệt**; người duyệt chấp nhận/từ chối; **không tự duyệt**.
- Máy chủ chỉ nhận ảnh trong vài phút sau lượt quét, từ tài khoản đã đăng ký, mỗi người một lượt mỗi hoạt động. Đồng hồ giao diện chỉ để nhắc.
- Ảnh: **xóa EXIF**, giới hạn loại/kích thước, lưu riêng tư, chỉ người duyệt của hoạt động và CTSV xem, có thời hạn xóa; thông báo trước khi chụp.
- **Chứng nhận tham gia** do hệ thống cấp khi lượt tham gia được duyệt, gồm:
  - mã;
  - hoạt động, sinh viên;
  - người duyệt, thời điểm;
  - hash.

  Chứng nhận thu hồi được (kèm lý do, không xóa). Không phải văn bằng hay chứng chỉ; không có chữ ký số (`NOT_VERIFIED`, `legalEffect=false`).
- CTSV là người thu hồi chứng nhận.

## Quyết định kỹ thuật

**Mã QR.**

- Mỗi hoạt động có một bí mật điểm danh ngẫu nhiên (256 bit), không bao giờ trả về trình duyệt.
- **QR in sẵn** chứa đường dẫn tới trang điểm danh của portal, kèm mã `HMAC-SHA256(bí mật, "static")`.
- **QR đổi liên tục** (bật theo hoạt động) dùng `HMAC(bí mật, cửa sổ 30 giây)`. Máy chủ nhận cửa sổ hiện tại và cửa sổ ngay trước. Khi bật chế độ này, mã in sẵn không còn dùng được.
- Chủ hoạt động **đặt lại bí mật** khi QR bị lộ. Mọi QR cũ mất hiệu lực, ghi lịch sử.
- QR được máy chủ sinh dạng SVG (thư viện `qrcode`) để in hoặc chiếu.

**Lượt điểm danh.**

1. **Quét QR.** Máy chủ kiểm:
   - hoạt động đang `PUBLISHED`;
   - đang trong giờ bắt đầu → kết thúc;
   - sinh viên đang giữ chỗ (`REGISTERED` sau `activity_settle`) và vẫn đúng đối tượng;
   - mã đúng.

   Nếu đạt, máy chủ mở **phiên chụp 3 phút**.
2. **Gửi ảnh** trong phiên chụp. Lượt chuyển sang `PENDING_REVIEW`.
3. Người duyệt **chấp nhận** (`APPROVED`, cấp chứng nhận) hoặc **từ chối** (`REJECTED`, bắt buộc lý do).

- Một dòng mỗi sinh viên mỗi hoạt động.
- **Giả định:** phiên chụp hết hạn mà chưa gửi ảnh thì được quét lại trong giờ hoạt động, để máy chậm hoặc mạng yếu không bị mất lượt. Đã gửi ảnh thì không làm lại.
- Trigger database kiểm điều kiện thời gian, giữ chỗ và chuyển trạng thái, và chặn người duyệt trùng với sinh viên.

**Ảnh.**

- Ảnh phải là JPEG (trình duyệt chụp bằng canvas), tối đa 2 MB.
- Máy chủ **bỏ mọi đoạn APP1–APP15 và COM** (EXIF, GPS, XMP, ghi chú) trước khi lưu. Chỉ lưu bản đã làm sạch kèm SHA-256.
- Ảnh lưu bằng cơ chế lưu tệp riêng tư đã có, thư mục riêng `activity-photos`.
- Chỉ người duyệt của hoạt động và CTSV tải được ảnh; mọi lần xem ghi audit.
- **Giả định:** ảnh bị xóa **90 ngày sau khi hoạt động kết thúc**, bằng lệnh dọn dẹp chạy theo lịch (lập lịch thuộc Sprint 13). Chứng nhận không chứa ảnh.

**Người duyệt lượt tham gia.**

- Ai được duyệt: cán bộ của đơn vị chủ hoạt động, hoặc người phụ trách CLB chủ/được giao.
- Không ai duyệt lượt của chính mình.
- Có duyệt nhiều lượt một lần (tối đa 100, phải xác nhận) cho hoạt động đông người.

**Chứng nhận.**

- Bảng `activity_certificates` lưu:
  - mã `CN-` cùng 12 ký tự base32;
  - hoạt động, sinh viên, lượt tham gia;
  - người duyệt, thời điểm;
  - `payload_sha256`;
  - `NOT_VERIFIED`, `legal_effect=false`.
- Trigger chặn xóa, chặn sửa nội dung và chỉ cho `ISSUED → REVOKED`.
- **Thu hồi:** chỉ CTSV (`activity.moderate`), bắt buộc lý do. Thu hồi không sửa bản kê khai đã nộp hay điểm đã duyệt (11.5).
- Sinh viên xem chứng nhận của mình.

**Vắng.** Hoạt động đã kết thúc, sinh viên còn giữ chỗ và không có lượt `APPROVED`. Đây là quy tắc suy ra của ADR 0031, nay dựa trên dữ liệu điểm danh thật.

## Rủi ro đã chấp nhận

- QR in sẵn có thể bị chụp gửi qua chat. Lớp chặn là selfie thấy hội trường và người duyệt.
- Ghép ảnh hay camera ảo vẫn qua mặt được; không tuyên bố chống gian lận tuyệt đối.
- Camera trên web cần HTTPS (trừ `localhost`). Thử trên điện thoại thật thuộc hạ tầng Sprint 13.

## Ngoài phạm vi

Nhận diện khuôn mặt; xác minh vị trí; NFC; ứng dụng di động riêng; ban tổ chức và gợi ý điểm (11.5).
