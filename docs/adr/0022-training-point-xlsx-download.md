---
status: Accepted
date: 2026-10-23
scope: Sprint 10.2 authenticated XLSX generation and prepared-response audit
---

# ADR 0022 — Tải Excel kết quả đã duyệt

Tiếp tục ADR 0021 theo yêu cầu chủ dự án. Thêm POST /api/v1/user/training-reviews/periods/:id/export.xlsx cho session cổng user và Origin hợp lệ. Body là object rỗng {}, từ chối trường thừa. POST bảo đảm Origin trong luồng fetch cùng miền và tránh speculative GET/HEAD sinh tệp hoặc ghi audit. Không nhận bộ lọc tùy ý, không thêm schema/catalog hoặc thay migration. Quyền xuất giữ nguyên ADR 0021; SYSTEM_ADMIN không thay vai trò cố vấn/khoa.

## Tệp và giới hạn

Tái sử dụng fflate/OpenXML đang có trong ứng dụng để bộ chạy API tự tạo XLSX, không thêm dependency dành riêng cho môi trường Codex. Hai sheet “Thông tin” và “Kết quả đã duyệt” cùng một snapshot; metadata chứa thống kê và tiêu chí, detail chỉ chứa bản APPROVED. Mã sinh viên/UUID/hash và mọi chuỗi không tin cậy là inlineStr, không bao giờ là công thức/hyperlink. Điểm/số lượng/trung bình giữ dạng số; ngày là Excel serial với định dạng UTC+7 rõ ràng. Đây là bản xuất giá trị tại thời điểm chốt, không có công thức tự thay đổi điểm khi sửa file. Không sinh xếp loại hoặc chữ ký giả.

Giữ riêng điểm tự khai và điểm duyệt A–E; actor và receipt từ snapshot. Đóng băng bốn hàng đầu và cột nhận dạng, có lọc ở hàng tiêu đề. Tối đa 1.000 bản duyệt theo ADR 0021 và 8 MiB byte nén; tối đa hai tác vụ trong một instance, một tác vụ/tài khoản, cộng rate limit 5 yêu cầu/phút/IP. Quá giới hạn phải từ chối rõ, không cắt ngầm. Sinh hoàn toàn trong bộ nhớ, không có tệp tạm để rò rỉ trên đĩa. Giới hạn concurrency là theo process, chưa phải điều phối đa instance.

## Quyền và audit

Service capture snapshot và kiểm lại quyền, sinh byte ngoài transaction, tính SHA-256 rồi gọi recordExport. Repository khóa SHARE các bảng quyền/phân công giống workflow hiện có, kiểm lại quyền/phạm vi hiện tại và ghi audit trong cùng transaction ngắn. Lỗi audit hoặc mất quyền chặn toàn bộ trả byte, không coi tác vụ thành công. Không giữ khóa trong lúc sinh Excel. Slot tác vụ luôn được nhả khi lỗi.

Audit action training.export.xlsx.prepared ghi actor hiện tại, requestId/IP/user-agent theo chuẩn hệ thống, periodId, snapshotId, số hàng, dung lượng và SHA-256. Không ghi tên sinh viên, điểm, nhận xét, nội dung bảng hoặc storage key trong metadata. SUCCESS nghĩa là máy chủ đã chuẩn bị tệp và cho phép trả phản hồi, không chứng minh trình duyệt đã nhận đủ hoặc lưu tệp. Hai lần tải là hai snapshot riêng; không giả lập idempotency cho lượt tải.

Phản hồi có MIME XLSX, attachment với tên dựa trên UUID snapshot, nosniff, private/no-store kể cả lỗi. Có X-Export-Snapshot-Id và X-Export-Sha256 ở phản hồi thành công. Không có header nhận dạng tệp khi audit/quyền thất bại. Không mở API ở cổng admin. HTTP validation/rate-limit dùng chuẩn Fastify hiện có. UI tải và xử lý hủy yêu cầu phía trình duyệt thuộc increment 10.4; export hoàn toàn trong bộ nhớ, lỗi mạng không tạo tệp rác trên đĩa.

## Kiểm chứng

Đọc lại XLSX bằng reader độc lập: dấu tiếng Việt, mã có 0 đầu, số 0 thật, rỗng/chưa duyệt, số hàng/tổng/trung bình, ngày UTC+7. Kiểm chuỗi công thức không tạo formula/external link/macro, biên 1.000/1.001 dòng và DTO hỏng. Unit service kiểm lỗi render/audit, mất quyền sau render, quá dung lượng và nhả slot. HTTP/SQL dùng DB giả riêng kiểm session/audience, Origin, role/scope, thu hồi quyền sau render, audit/hash, lỗi audit không trả byte và rate limit. Rà hình hai sheet từ tệp mẫu thực tế; không suy native Excel QA từ riêng việc đọc XML thành công.
