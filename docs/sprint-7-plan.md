# Sprint 7 — Workflow ký mô phỏng

Trạng thái **CLOSED kỹ thuật local** ngày 14/10/2026, theo yêu cầu “tiếp tục sang sprint 7 nếu đạt yêu cầu” và “tiếp tục”. Sprint 6 đạt điều kiện local; phạm vi không bao gồm production/UAT.

MVP đã hoàn tất: quyền ký mô phỏng riêng, bước ký sau duyệt đúng người/round/tài liệu đã lưu, receipt/hash bất biến, đối chiếu và audit, idempotency/concurrency, HTTP và panel user/admin. Dữ liệu giả, luôn NOT_VERIFIED/legalEffect=false; chưa cấp văn bản hoặc dùng con dấu/chứng thư thật. [ADR0018](adr/0018-mock-signing-workflow.md) được commit trước schema.

Điều kiện đóng đã kiểm chứng: 711 test đạt, 1 skip Windows; typecheck/lint/format/build đạt; diễn tập browser mới 30 nhóm, 40 lượt responsive, snapshot nguồn không đổi; đã xem ảnh và trang Word/PDF. [Biên bản](sprint-7-closure.md), [trạng thái](sprint-7-status.json) và [hướng dẫn thao tác](sprint-7-mock-signing-guide.md). Giữ nguyên hồ sơ đóng Sprint 6. Production NOT_READY.
