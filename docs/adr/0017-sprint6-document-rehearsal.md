---
status: Accepted
date: 2026-10-14
scope: Local technical Sprint 6 acceptance, synthetic data only
---

# ADR 0017: Kiểm chứng trọn luồng Sprint 6 bằng môi trường riêng

Theo ủy quyền “triển khai đến khi xong sprint 6”, chạy một lần tiếp nhận, bổ sung, duyệt/từ chối, Word/PDF và gói hồ sơ trên API/PostgreSQL/kho đĩa/trình duyệt thật bằng dữ liệu giả. Profile sprint6 cố định 127.0.0.11:3030/3031, UUID/state/origin riêng, checker cần parent IPC. Từ chối DATABASE_URL/kho kế thừa hoặc production; không dùng lại phiên thực hành. Kết thúc thu hồi đúng process/container sở hữu.

Mở rộng phạm vi ADR 0015 từ mock-signature sang diễn tập sprint6 riêng: dùng cùng bootstrap/profile sealed bằng tài liệu giả, giới hạn hai lần bootstrap90s, retry chỉ khi timeout đã reaped; manifest/hash binary/file, bản sao profile độc lập cho từng tác vụ, provenance và deadline PDF90s giữ nguyên. Không chạy signer hoặc chứng nhận hiệu lực pháp lý. Server mặc định và development không tự bật hook này.

Kiểm tra tải Word/PDF hiện tại/lịch sử qua owner, reviewer và admin, byte/round/template/minh chứng của ZIP; đối chiếu registry với file thật và source Word của PDF trước khi dừng database giả. Ảnh responsive và mọi trang Word/PDF phải được xem trước khi đóng sprint. Không chấp nhận report cũ hoặc output từ process timeout.

Đóng Sprint 6 trong phạm vi kỹ thuật local theo ủy quyền người dùng, ghi riêng trạng thái/evidence. Không giả lập chữ ký chủ dự án hoặc nghiệm thu Học viện. Phạm vi Sprint 6 theo kế hoạch hợp nhất là xét hồ sơ/tài liệu; kích hoạt kho bền vững trên server chính và nâng database legacy của B2, backup khác thiết bị/B3, production/UAT, ký/phát hành Sprint 7 được ghi rõ ở backlog riêng. API chính hiện render theo yêu cầu; rehearsal vault không đồng nghĩa đã kích hoạt lưu bền vững mặc định. Giấy xác nhận sinh viên tiếp tục OFFLINE tại CTSV.
