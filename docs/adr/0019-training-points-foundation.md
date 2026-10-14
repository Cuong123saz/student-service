---
status: Accepted
date: 2026-10-14
scope: Sprint 8 foundation, synthetic local acceptance
---

# ADR 0019 Nền tảng điểm rèn luyện

Theo roadmap hợp nhất, Sprint 8 gồm đợt đánh giá, tiêu chí A–E, kê khai/minh chứng và lịch sử; xét duyệt cố vấn/khoa thuộc Sprint 9. Chủ dự án yêu cầu tiếp tục Sprint 8 sau khi Sprint 7 CLOSED local. Dùng dữ liệu giả đúng kiểu, không tự coi điểm tự kê khai là kết quả được duyệt hoặc quy chế chính thức.

Mỗi đợt gắn một lớp, năm học và học kỳ, unique lớp/năm/học kỳ. DRAFT → OPEN → CLOSED, revision lạc quan, không mở lại. Cấu hình năm nhóm A–E, nhãn/điểm tối đa/yêu cầu minh chứng; tổng tối đa100. Bộ mặc định20 điểm/nhóm ghi rõ giả định, quản trị sửa trước khi mở. Tên/lịch/tiêu chí cố định sau khi mở; thời gian kê khai kiểm bằng giờ máy chủ và trạng thái đợt. Không xếp loại hoặc ký/duyệt.

Quyền training_point.period.manage chỉ mặc định cho SYSTEM_ADMIN; có thể cấp riêng cùng role/scope GLOBAL/FACULTY/CLASS hiện tại. Catalog và thao tác kiểm quyền cùng role, user/class/faculty hoạt động. Không suy quyền từ JWT. Sinh viên ACTIVE/STUDENT/hồ sơ lớp hợp lệ xem đợt của lớp hiện tại và lịch sử của chính mình; chuyển lớp không làm mất bản đã kê khai nhưng không được tiếp tục sửa/nộp đợt cũ. Portal admin quản lý đợt, không xem bản nháp sinh viên trong Sprint 8.

Thêm training_periods, training_declarations, training_evidence, training_events. Một bản kê khai/sinh viên/đợt. Draft cho phép thiếu/null, giữ đúng0; điểm nguyên trong giới hạn, giải trình bắt buộc khi điểm dương. Khi nộp phải đủ năm nhóm và minh chứng cho nhóm điểm dương có yêu cầu; chốt profile/tiêu chí/trả lời/tệp/tổng điểm. SUBMITTED bất biến, không sửa/gỡ tệp hoặc nộp bản mới trong Sprint 8. Lịch sử sự kiện append-only; thay đổi và audit cùng transaction, lỗi audit rollback.

Upload PDF/PNG/JPEG sniff MIME, tối đa5MiB/tệp,3/nhóm,10 tệp và20MiB/bản. Kho UUID riêng bên dưới training-points; không đưa storage key vào API/UI. SHA-256/size kiểm khi đọc; mọi tệp NOT_CHECKED. Kiểm quyền trước/sau I/O, không giữ transaction lúc đọc/ghi đĩa. Transaction cuối khóa quyền và đợt/bản kê khai theo cùng thứ tự, kiểm lại giờ/quyền/revision. Upload gửi lại cùng requestId/binding trả cùng tệp; file mới chưa commit được thu hồi theo key sở hữu. Gỡ logical, giữ byte cho lịch sử. Nộp dùng requestId cùng binding/revision để chống gửi đôi; unique và row lock chặn đua request.

HTTP tách user/admin, Origin cho mutation, strict input, bounded body/file/rate limit, cache private/no-store. UI quản trị đợt và sinh viên kê khai/lịch sử dùng giao diện hiện có, nhóm A–E đọc được trên mobile, xác nhận trước mở/đóng/nộp, lỗi gần trường, phản hồi cũ không ghi đè hồ sơ khác. Điểm tự kê khai luôn ghi chưa xét duyệt.

Diễn tập riêng sprint8 .13:3034/3035, PostgreSQL tmpfs và storage clone riêng, cần parent IPC; từ chối nguồn/production, dọn đúng tài nguyên sở hữu. Không sửa mẫu Word, nguồn legacy, trạng thái các sprint trước hoặc dùng khóa/chứng thư thật. Test quyền/scope, thời hạn, kiểu điểm, snapshot/history/audit, revision/idempotency/concurrency, I/O quyền và tải tệp; browser thật trước đóng local. Hardening/backup/UAT production thuộc Sprint 13 và increment vận hành đã ghi.
