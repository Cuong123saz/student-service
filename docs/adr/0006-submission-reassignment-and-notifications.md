---
status: Accepted
date: 2026-10-10
---

# ADR 0006: Bàn giao cán bộ và thông báo trong ứng dụng

Chủ dự án chấp nhận kế hoạch tiếp theo trong hội thoại: triển khai đợt gần nhất gồm bàn giao cán bộ và thông báo trong ứng dụng. ADR bổ sung ADR0001–0005, commit riêng trước migration0018. Không tự đóng Sprint4/5. STUDENT_CONFIRMATION tiếp tục OFFLINE trực tiếp CTSV. Không ký/phát hành, email/push hoặc mở lại quyết định cuối; phân trang hàng đợi và chuẩn bị production thuộc đợt sau.

## Quyền và phạm vi bàn giao

Thêm permission submission.assign, mô tả Phân công lại cán bộ xử lý hồ sơ. Catalog16 permission,34 grant mặc định: chỉ SYSTEM_ADMIN có grant mới theo chính sách catalog; ADMIN/các reviewer không tự được cấp. Migration/seed thêm catalog/grant SYSTEM_ADMIN conflict-safe, không xóa grant thủ công, không đổi tài khoản hay cấu hình thủ tục để demo. Cập nhật constants/test/ma trận đồng bộ.

Supervisor phải ACTIVE, không buộc đổi mật khẩu, có submission.assign và submission.review trên CÙNG role assignment có GLOBAL hoặc ORGANIZATION của processingUnit ACTIVE; khác studentUserId. ADMIN không là điều kiện thay cho quyền. Người nhận mới ACTIVE, không buộc đổi mật khẩu, có submission.review và scope phù hợp cùng role, khác sinh viên và khác người nhận hiện tại. Người phân công có thể là người nhận mới nếu đủ điều kiện. Không yêu cầu người cũ còn quyền; mục đích gồm giải cứu hồ sơ khi người cũ mất quyền.

Chỉ IN_REVIEW/NEEDS_SUPPLEMENT đã có người nhận được bàn giao. Không đổi trạng thái, revision tăng1, updatedAt cập nhật. Giữ nguyên bản làm việc/bản nộp/tệp/round/tuyến/unit/procedure/studentSnapshot/submittedAt/lastSubmittedAt/decisionAt/reviewStartedAt đầu tiên. designatedReviewerId gốc bất biến để đối chiếu; từ sau lần nhận đầu, reviewerUserId là người đang chịu trách nhiệm, kể cả sau bàn giao. Resubmit/resolve/tải tệp không ép current reviewer bằng designated gốc. Không chuyển đơn vị hoặc tự động chọn người.

| Hồ sơ | Quyền đọc cán bộ |
| --- | --- |
| SUBMITTED chỉ định riêng | Giữ designated gốc theo ADR4, chưa có bàn giao |
| IN_REVIEW/NEEDS_SUPPLEMENT chỉ định riêng | Current reviewer, hoặc supervisor assign+review cùng role/scope để bàn giao |
| APPROVED/REJECTED chỉ định riêng | Current reviewer; ngoại lệ supervisor bàn giao hết hiệu lực |
| Không chỉ định cá nhân | Giữ observer submission.review đúng phạm vi như ADR4 |

Mọi nhánh vẫn yêu cầu current quyền review, unitACTIVE, không tự xử lý. Người cũ của hồ sơ chỉ định riêng mất quyền đọc khi chuyển; người cũ của queue có thể còn quyền observer nhưng không quyết định. Dù là supervisor, chi tiết và tệp chỉ lấy round đã gửi, không lộ bản bổ sung đang sửa. File reauthorization trước/sau I/O áp dụng visibility mới.

## Lịch sử, transaction và retry

Thêm REASSIGNED vào submission_events; fromReviewerUserId/toReviewerUserId (private UUID), fromReviewerName/toReviewerName frozen, chỉ có cho sự kiện này. Note văn bản thuần trim1–2000 bắt buộc. Event từ revision cũ đến revision+1, round hiện tại. Các action cũ có bốn trường này null. Timeline cho owner/cán bộ hợp lệ hiển thị tên cũ/mới/lý do; không trả UUID cán bộ trong lịch sử. Round/event append-only giữ nguyên.

Khóa service -> submission; kiểm quyền hiện tại trước/sau khóa. Từ expectedRevision tra event: cùng actor/REASSIGNED/toReviewerUserId/note chuẩn hóa là retry đúng, trả DTO hiện tại không ghi event/audit/notification trùng. Retry vẫn cần supervisor hiện tại và quyền đọc; không yêu cầu người đích hiện còn hợp lệ nếu thao tác trước đã commit. Payload khác cùng revision409. Yêu cầu mới phải currentrevision, đúng trạng thái/người nhận đủ điều kiện; target không hợp lệ422 INVALID_ASSIGNEE, note sai422 INVALID_REASSIGNMENT, state/revision409. Người không scope không được dò hồ sơ. Parent update, event, audit SUBMISSION_REASSIGN và notification cùng transaction; lỗi bất kỳ rollback toàn bộ. Audit không lưu note hoặc câu trả lời.

Migration0018 bổ sung cột/constraint/index, thay function protect_submitted_content bằng phiên bản có nhánh bàn giao: cùng trạng thái IN_REVIEW/NEEDS, đổi reviewer, revision+1, chỉ thay reviewerUserId/revision/updatedAt; các trường khác bất biến. Giữ mọi nhánh/guard0017, không sửa migration cũ. DBconstraint REASSIGNED phải có hai UUID khác nhau/tên không rỗng/note hợp lệ. Giữ trigger event/round chống UPDATE/DELETE.

## API bàn giao

- ReviewDetail thêm canReassign:boolean, server xác định quyền cùng trạng thái hiện tại. Các nút theo quyền server, server kiểm lại khi ghi.
- GET /api/v1/{user|admin}/review-submissions/:id/assignees chỉ supervisor đang được bàn giao, trả {candidates:[{id:string,fullName:string}]}; loại người hiện tại/sinh viên, chỉ người đủ review/scope. Đây là danh sách nội bộ cho thao tác được cấp quyền, không trả username/email/role/password hoặc UUID người cũ.
- POST /api/v1/{user|admin}/review-submissions/:id/reassign body {expectedRevision:number,reviewerUserId:uuid,note:unknown}; kiểm note là string trước trim, không để AJV ép null/number thành chuỗi; trả ReviewDetail. Params/body strict, Origin/cookie audience hiện hành.
- SubmissionEventView thêm reassignment:{fromReviewerName:string,toReviewerName:string}|null; các event cũ null. Không trả private IDs.
- UI chọn người nhận/ghi lý do, xem lại/xác nhận rồi Bàn giao hồ sơ. Mất mạng/5xx/409 khóa thao tác, giữ người/lý do và GET đối chiếu; phản hồi trễ không ghi đè hồ sơ khác. Cập nhật lịch sử/người nhận/allowedActions/canReassign theo DTO mới.

## Thông báo bền vững và riêng tư

Thêm personal_notifications: id UUID, recipientUserId FKuser, recipientKind OWNER|REVIEWER, submissionId, eventId, createdAt, readAt nullable. FK(eventId,submissionId) -> submission_events(id,submissionId), unique(eventId,recipientUserId,recipientKind), index(recipientUserId,createdAt,id). Metadata bất biến, chỉ readAt null -> timestamp hoặc giữ nguyên; không UPDATE thông tin gốc/DELETE. Không chép note/values/studentSnapshot/tên tệp vào thông báo. Tiêu đề/diễn giải là nhãn chung theo action; link máy chủ dựng từ submissionId và portal, không nhận URL bên ngoài.

Chỉ phát sinh cùng transaction khi event mới được ghi:

| Action | Người nhận |
| --- | --- |
| SUBMITTED | designatedReviewerId nếu có; không fan-out mọi người trong queue |
| CLAIMED | cán bộ đã nhận |
| REASSIGNED | người nhận mới và sinh viên owner |
| RESUBMITTED | current reviewer |
| SUPPLEMENT_REQUESTED/APPROVED/REJECTED | sinh viên owner |

Không dựng thông báo từ lịch sử cũ; retry không gửi trùng. Không gửi người cũ đã mất quyền đọc. Bản ghi thông báo vẫn được giữ khi thu hồi quyền, nhưng list/count/mark-read phải lọc current eligibility trước limit/count: đúng recipient + ACTIVE/notpasswordpending + role hiện tại dùng được portal. OWNER chỉ cổng user với STUDENT hiện tại/đúng owner; REVIEWER cần quyền đọc hồ sơ hiện tại theo bảng visibility. Cổng admin chỉ thông báo REVIEWER; cổng user có OWNER/REVIEWER theo role. Cùng identity có thể đọc REVIEWER qua hai cổng nếu được dùng cả hai; readAt dùng chung. JWT role/permission cũ không vượt thu hồi DB hiện tại. Bấm link còn phải được route hồ sơ kiểm lại quyền.

- GET /api/v1/{user|admin}/notifications query {cursor?:string,unreadOnly?:boolean}; trả {items:NotificationView[],nextCursor:string|null,unreadCount:number}. Trang20, seek theo createdAt DESC,id DESC, cursor đã validate cả timestamp/UUID. Lọc quyền trước limit. unreadCount tổng thông báo CHƯA ĐỌC còn được xem, không chỉ trang hiện tại.
- GET /api/v1/{user|admin}/notifications/unread-count trả {unreadCount:number}.
- POST /api/v1/{user|admin}/notifications/:id/read body {}, Origin bắt buộc; chỉ recipient có current eligibility. Idempotent readAt không đổi lần hai, trả {id,readAt,unreadCount}. ID người khác/không còn quyền404. API current account/role mất điều kiện403, wrongcookie401. Lỗi không đánh dấu đã đọc trên UI.
- NotificationView={id,action,title,message,createdAt,readAt:string|null,targetUrl:string}; action là event action, không có userUUID/eventUUID/note/storageKey/values. targetUrl owner /submissions/:id; reviewer /review-submissions/:id hoặc /admin/review-submissions/:id theo portal.
- Trang /notifications và /admin/notifications, tất cả/chưa đọc, tải thêm, đánh dấu đã đọc, Mở hồ sơ. Link Thông báo có count ở publicheader khi user đăng nhập và adminnav. Loading/empty/error/retry, keyboard/mobile. Không đánh dấu chỉ vì mở trang inbox; chỉ nút read hoặc Mở hồ sơ thành công mark-read trước điều hướng. Mark-read lỗi giữ trạng thái/nút retry. Count refresh khi vào trang/focus hoặc refresh thủ công, không hứa realtime/push. State cache tách portal/user, logout/đổi phiên xóa dữ liệu cũ, bỏ phản hồi trễ.

## Kiểm chứng và giới hạn

SQL guard giữ content/round/files/designated/reviewStartedAt, immutability, backfill0017 không đổi và không tạo notification lịch sử. API cả hai cổng/Origin, cùng-role assign+review/scope, target sai/mất quyền, student/self, terminal/queueSUBMITTED, designated chuyển thành công/người cũ mất đọc/tải/resolve, queueobserver giữ quyền, roundhistory/workingcopyhidden, resubmit về người mới dù người cũ inactive, hai bàn giao hoặc bàn giao/resolve đồng thời, exact/different retry, audit/event/notification rollback. Inbox: recipient isolation, scope/account/role revocation, designation supervisor hết quyền terminal, count/filter trướclimit, seek không trùng, readidempotent, wrongportal/Origin và privacy DTO. Web: confirm/note/currentrights/stale navigation, unknown/conflict giữ dữ liệu, inbox readerrors/paging/count/logout isolation. Demo thật student/oldreviewer/newreviewer/supervisor trên DBtest riêng, hai cổng, desktop/mobile.

Phạm vi local, chưa email, ký/cấp, tự động chuyển đơn vị, nhận lại quyết định cuối hoặc production. Chưa phân trang hàng đợi/historicalrounds; chưa thay điều kiện backup/retention/quét mã độc. Chủ dự án nghiệm thu riêng, không tự đóng sprint.
