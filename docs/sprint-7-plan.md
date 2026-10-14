# Sprint 7 — Workflow ký mô phỏng

Trạng thái IN_PROGRESS, theo yêu cầu “tiếp tục sang sprint 7 nếu đạt yêu cầu”. Sprint 6 đã đạt local; điều kiện không bao gồm production/UAT.

Phạm vi MVP: quyền ký mô phỏng riêng, bước ký sau duyệt đúng người/round/tài liệu đã lưu, receipt/hash bất biến, đối chiếu và audit, idempotency, HTTP và panel user/admin. Dữ liệu giả, luôn NOT_VERIFIED/legalEffect=false; không cấp văn bản hoặc dùng con dấu/chứng thư thật. [ADR0018](adr/0018-mock-signing-workflow.md) phải có trước schema.

Điều kiện đóng: tests về quyền/binding/tamper/đua request/audit/append-only đạt; build/typecheck/lint; diễn tập browser mới với snapshot Word/PDF/minh chứng không đổi, xem ảnh responsive; trạng thái riêng và bằng chứng. Giữ nguyên hồ sơ đóng Sprint 6.
