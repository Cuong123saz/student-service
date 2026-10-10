---
status: Accepted
date: 2026-10-10
---

# ADR 0005: Bổ sung hồ sơ và quyết định xử lý

Chủ dự án yêu cầu tiếp tục bước yêu cầu bổ sung và quyết định xử lý sau increment gửi/tiếp nhận. Quyết định triển khai của dự án cá nhân, không phải xác nhận quy trình chính thức của Học viện hoặc thẩm quyền ký. Bổ sung ADR0001–0004; không tự đóng Sprint4. Giữ STUDENT_CONFIRMATION OFFLINE, liên hệ trực tiếp CTSV; không đổi catalog grant, tài khoản hoặc cấu hình development để demo.

## Trạng thái và thẩm quyền

- Giữ DRAFT -> SUBMITTED -> IN_REVIEW. Thêm IN_REVIEW -> NEEDS_SUPPLEMENT | APPROVED | REJECTED. Sinh viên gửi bổ sung NEEDS_SUPPLEMENT -> IN_REVIEW về đúng reviewerUserId; không nhận lại, không tự phân công lại. APPROVED/REJECTED kết thúc và chỉ xem, không mở lại ở increment này.
- Chỉ reviewerUserId đã nhận hồ sơ, ACTIVE, không bắt buộc đổi mật khẩu, khác sinh viên, còn submission.review cùng GLOBAL/ORGANIZATION đúng đơn vị ACTIVE trên cùng role assignment được quyết định. Chỉ định cá nhân vẫn áp dụng kể cả GLOBAL. APPROVE là duyệt nội dung trong ứng dụng bằng submission.review; REQUEST_SUPPLEMENT và REJECT cần thêm submission.reject trên chính role có quyền review và scope phù hợp. Không ghép quyền ở role này với scope/quyền ở role khác, không tự cấp quyền ADMIN.
- Mọi quyết định yêu cầu expectedRevision và note văn bản thuần sau trim dài1–2000 ký tự. Người cùng phạm vi chỉ xem, không quyết định thay người đã nhận. Kiểm tra quyền thực tế DB/cổng/Origin như ADR0004.
- APPROVED hiển thị Đã duyệt nội dung và REJECTED Không chấp thuận. Cả hai là quyết định nội dung, không khẳng định đã cấp văn bản, ký số hoặc có giá trị pháp lý. SignatureStatus vẫn NOT_CHECKED.

## Bản làm việc, lần gửi và lịch sử

- Thêm submission_rounds bất biến: UUID, submissionId, roundNumber, submittedAt, studentSnapshot4, values, files snapshot (metadata/hash/storageKey nội bộ), source LIVE|MIGRATION. Unique(submissionId,roundNumber). Mỗi lần gửi hợp lệ chốt round mới cùng transaction; không nhân bản byte gốc.
- Thêm submissions.roundNumber (0 với DRAFT), lastSubmittedAt và decisionAt. submittedAt luôn là lần gửi đầu; lastSubmittedAt là lần gửi mới nhất. reviewerUserId/reviewStartedAt giữ người/lần nhận đầu xuyên suốt bổ sung. decisionAt chỉ khác null khi APPROVED/REJECTED.
- Backfill round1 từ SUBMITTED/IN_REVIEW hiện có: dùng submittedAt/values/studentSnapshot/tệp đang liên kết, source MIGRATION. DRAFT không tạo round. Không bịa timeline thao tác trước migration.
- Thêm submission_events append-only: submissionId, roundId, action SUBMITTED|CLAIMED|SUPPLEMENT_REQUESTED|RESUBMITTED|APPROVED|REJECTED, actorUserId, actorName tại thời điểm hành động, note nullable, createdAt, fromRevision/toRevision. Unique(submissionId,fromRevision). Nội dung lý do chỉ nằm trong dữ liệu hồ sơ riêng, không ghi vào audit chung.
- Các lần gửi và sự kiện không UPDATE/DELETE. Binding (id/student/service/version/procedure/serviceName/createdAt), tuyến xử lý và reviewer đã nhận bất biến. Hồ sơ đã gửi chỉ sửa values/tệp trong NEEDS_SUPPLEMENT; hồ sơ gốc vẫn đọc được qua round. Chỉ soft-remove liên kết tệp đang làm việc; không đổi metadata/storageKey hoặc xóa tệp đã thuộc lịch sử.
- Khi NEEDS_SUPPLEMENT, owner xem/sửa bản làm việc, xem yêu cầu cụ thể và các round cũ. Cán bộ luôn xem values/files/studentSnapshot của round mới nhất đã gửi, tuyệt đối không thấy nội dung hoặc tệp sinh viên chưa gửi lại. Route tệp hiện tại của cán bộ cũng chỉ cho tệp thuộc round đã gửi gần nhất.
- Sinh viên được lưu thiếu, tải/gỡ tệp và xem lại/xác nhận như nháp. Dùng cấu hình/tuyến xử lý đã chốt dù biểu mẫu RETIRED hoặc service INACTIVE; đơn vị xử lý phải ACTIVE. Gửi lại refresh profile, validate toàn bộ nội dung/minh chứng và byte/size/hash, kiểm tra lại profile và routing sau I/O, tăng round và revision, audit/event/round nguyên tử. Cán bộ đã nhận phải còn quyền review đúng phạm vi; nếu mất quyền thì báo ROUTING_UNAVAILABLE, không tự chuyển người. Chưa có cơ chế phân công lại.

## Transaction và retry

Khóa service -> submission như hiện tại. Quyết định đồng thời chỉ một request thắng; revision khác trả409. Trước thay đổi, tra event từ expectedRevision: chỉ retry đúng actor/action/note chuẩn hóa được trả trạng thái hiện tại mà không tạo event/audit trùng; yêu cầu khác cùng revision trả409. Kiểm tra lại quyền hiện tại trước cả retry. Không coi chỉ cần ở trạng thái đích là retry thành công vì có nhiều vòng bổ sung.

POST submit hiện có xử lý DRAFT hoặc NEEDS_SUPPLEMENT. Revision cũ khi NEEDS_SUPPLEMENT trả409; khi trạng thái khác thì trả hiện trạng theo quy tắc idempotent ADR0004. Round/event/audit lỗi rollback cả thay đổi. Khi kết quả mạng/5xx không chắc chắn, UI khóa thao tác và yêu cầu GET kiểm tra trạng thái trước khi thử tiếp; giữ nội dung/lý do đang nhập, phản hồi cũ không ghi đè hồ sơ khác.

## Hợp đồng API/UI

- POST /api/v1/{user|admin}/review-submissions/:id/resolve body {expectedRevision,action:'REQUEST_SUPPLEMENT'|'APPROVE'|'REJECT',note}; trả ReviewDetail.
- GET queue query status thêm NEEDS_SUPPLEMENT|APPROVED|REJECTED; lọc trước limit50, giữ mặc định API bỏ query trả các trạng thái đã gửi và UI mặc định Chờ tiếp nhận. Mỗi nhóm riêng: Chờ tiếp nhận, Đang xử lý, Chờ bổ sung, Đã duyệt nội dung, Không chấp thuận.
- DraftView và ReviewDetail thêm roundNumber:number, lastSubmittedAt:string|null, decisionAt:string|null, rounds:SubmissionRoundView[], events:SubmissionEventView[]. ReviewDetail thêm allowedActions:ResolutionAction[] do server xác định; chỉ hiện nút tương ứng quyền hiện tại. ReviewSummary và danh sách sinh viên thêm roundNumber/lastSubmittedAt/decisionAt. Các trường cũ giữ nguyên.
- SubmissionRoundView={roundNumber,submittedAt,studentSnapshot:{fullName,studentCode,classCode,facultyCode},values,files:EvidenceView[],source:'LIVE'|'MIGRATION'}. SubmissionEventView={id,roundNumber,action,actorName,note:string|null,createdAt}. DTO không storageKey/actorUserId/reviewer UUID. Các action timeline dùng nhãn tiếng Việt, note được render text thuần.
- GET /api/v1/user/submissions/:id/rounds/:roundNumber/files/:fileId cho owner; GET /api/v1/{user|admin}/review-submissions/:id/rounds/:roundNumber/files/:fileId cho cán bộ đúng phạm vi. FileID phải thuộc round tương ứng, kể cả tệp bị gỡ khỏi bản làm việc. Kiểm tra quyền trước/sau storage I/O, size/hash, attachment/private/no-store/nosniff như hiện tại.
- UI cán bộ chọn hành động, nhập lý do, xem lại/xác nhận rồi ghi quyết định; không dùng thao tác tức thời gây nhầm. Sinh viên NEEDS_SUPPLEMENT có Gửi bổ sung và nội dung yêu cầu rõ ràng, giữ dirty/conflict/unknown guards; sau gửi readonly. Cả hai xem lịch sử lần gửi và diễn biến. Dùng thiết kế hiện có, keyboard/mobile và cảnh báo chữ ký chưa xác minh.

## Kiểm chứng và giới hạn

Test migration/backfill, round/event/file immutability bằngSQL, hai quyết định đồng thời, retry đúng/khác note, cả hai cổng/Origin, người cùng scope không phải người đã nhận, quyền reject ghép khác role, current revocation, tự xử lý, hai vòng bổ sung, profile/routing thay đổi trong I/O, retired form, tệp mới chưa gửi không lộ cho cán bộ, gỡ/đổi tệp vẫn tải round cũ, rollback event/audit. Web kiểm tra note/confirm, quyền nút, trạng thái và timeline/rounds, mất mạng/conflict giữ dữ liệu; demo ba vai trò với DB test riêng và mobile.

Chưa có email, ký, sinh văn bản/kết quả, phân công lại, thu hồi quyết định, xóa hồ sơ hoặc production. Kho local/backup/retention/quét mã độc theo ADR0003. Lịch sử trả toàn bộ round trong increment local; cần phân trang/lazy-load trước khi vận hành hồ sơ có nhiều vòng hoặc quy mô lớn. ADR Accepted phải commit riêng trước migration0017.
