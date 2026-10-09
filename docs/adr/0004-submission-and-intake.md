---
status: Accepted
date: 2026-10-09
---

# ADR 0004: Gửi hồ sơ và tiếp nhận xử lý

Chủ dự án yêu cầu tiếp tục bước kế tiếp sau bản nháp/minh chứng và cho phép tự chia việc triển khai, rà soát. Đây là quyết định triển khai trong phạm vi dự án cá nhân, không phải xác nhận quy trình chính thức của Học viện. Bổ sung ADR 0001–0003; không tự đóng nghiệm thu Sprint 4.

## Phạm vi

- DRAFT → SUBMITTED → IN_REVIEW. Gửi bản đã lưu; không gộp việc sửa câu trả lời với gửi. Sinh viên phải xem lại và xác nhận trước khi gửi. Chỉ ONLINE/HYBRID còn được áp dụng tiếp nhận; STUDENT_CONFIRMATION giữ OFFLINE tại CTSV.
- Gửi yêu cầu expectedRevision, khóa service rồi submission để đồng bộ publish/save/upload. Máy chủ cập nhật các trường PROFILE từ hồ sơ học vụ hiện tại, kiểm tra kiểu dữ liệu, toàn bộ mục bắt buộc và giới hạn minh chứng. Đọc kiểm tra byte gốc/size/SHA-256 của các tệp đang liên kết trong khi giữ khóa; tệp thiếu/sai toàn vẹn trả 503, không gửi dở dang.
- Tại lúc gửi, chốt submittedAt, processingUnitId, designatedReviewerId theo phiên bản gốc và studentSnapshot (mã sinh viên, họ tên, lớp, khoa). Snapshot chỉ cho hồ sơ cụ thể; không mở quyền đọc danh mục student_profiles cho ORGANIZATION.
- Kiểm tra lại đơn vị ACTIVE và cán bộ nhận ACTIVE có submission.review cùng GLOBAL/ORGANIZATION đúng đơn vị trên chính một role assignment. Nếu chỉ định một cán bộ thì người đó phải hợp lệ; nếu hàng đợi đơn vị thì phải còn ít nhất một người hợp lệ. Không tự gán quyền theo ADMIN hoặc chuyển hồ sơ sang người khác khi người được chỉ định mất quyền.
- SUBMITTED/IN_REVIEW khóa câu trả lời, cấu hình, danh tính sinh viên và danh sách minh chứng; không sửa/lưu/tải thêm/gỡ hoặc xóa nội dung. Database trigger bổ sung bảo vệ nội dung đã gửi, còn trạng thái/nhận xử lý là chuyển đổi riêng. Byte gốc luôn được giữ. Audit cùng transaction; lỗi audit rollback cả gửi/nhận.
- Gửi lại hồ sơ đã gửi của chính mình trả trạng thái hiện tại và không tạo receipt/audit trùng. Khi còn DRAFT, revision cũ trả 409. Một hồ sơ trên mỗi sinh viên/phiên bản vẫn áp dụng ở increment này; chưa có lần nộp tiếp theo cho cùng phiên bản.

## Hàng đợi và nhận xử lý

- Hai cổng API user/admin dùng phiên tương ứng và kiểm tra quyền thực tế trong database trên mỗi thao tác. Phiên bắt buộc đổi mật khẩu không được thao tác. Không chỉ tin role trong cookie; không thay đổi quyền catalog mặc định.
- Chỉ SUBMITTED/IN_REVIEW được đọc bởi cán bộ có submission.review + GLOBAL hoặc ORGANIZATION đúng processingUnitId trên cùng role assignment, đơn vị ACTIVE. Hồ sơ chỉ định riêng chỉ hiển thị cho designatedReviewerId, kể cả khi người khác có scope GLOBAL. Không được tự xem/nhận hồ sơ của chính mình qua vai trò cán bộ.
- Hàng đợi sắp theo thời gian gửi, tối đa 50 hồ sơ trong phạm vi; không trả dữ liệu/đếm ngoài phạm vi. Bản nháp không xuất hiện. Detail và tải tệp kiểm tra lại cùng quyền; ngoài phạm vi trả 404, người không còn bất kỳ quyền review hợp lệ trả 403.
- Nhận xử lý yêu cầu expectedRevision; khóa hồ sơ, xác thực quyền và chuyển SUBMITTED → IN_REVIEW với reviewerUserId/reviewStartedAt, tăng revision, audit nguyên tử. Hai cán bộ cùng nhận chỉ một người thắng; lần sau của chính người đã nhận là idempotent, người khác nhận lại trả 409. Cán bộ đủ phạm vi vẫn có thể xem tiến độ của hàng đợi đơn vị.
- Snapshot của hồ sơ đã gửi tiếp tục đọc/xử lý khi phiên bản nghỉ hoặc dịch vụ ngừng; quyền hiện tại và trạng thái đơn vị xử lý vẫn được kiểm tra. Sinh viên còn đủ điều kiện vẫn đọc/tải tệp của chính mình. Không lộ UUID người được chỉ định hoặc khóa lưu tệp trong DTO sinh viên.
- Tất cả thao tác ghi kiểm tra Origin. Tải tệp owner/cán bộ có quyền dùng attachment, private/no-store, nosniff và kiểm tra toàn vẹn.

## Hợp đồng API/UI

StudentDraft mở rộng status DRAFT|SUBMITTED|IN_REVIEW, submittedAt/reviewStartedAt nullable. POST /api/v1/user/submissions/:id/submit body { expectedRevision } trả StudentDraft. editable chỉ true với DRAFT còn hợp lệ. Danh sách sinh viên thêm submittedAt/reviewStartedAt, hiển thị trạng thái thật.

Hai prefix /api/v1/user/review-submissions và /api/v1/admin/review-submissions cùng hỗ trợ GET danh sách, GET /:id, POST /:id/claim body { expectedRevision }, GET /:id/files/:fileId. DTO hàng đợi: id, serviceName, status, revision, submittedAt, processingUnitName, student { fullName, studentCode }, reviewerName nullable, canClaim. Detail thêm serviceId, procedure, values, files, studentSnapshot { fullName, studentCode, classCode, facultyCode }, reviewStartedAt nullable; không trả storageKey, designatedReviewerId hay toàn bộ hồ sơ học vụ. canClaim chỉ true cho SUBMITTED đang đủ quyền. Lỗi tương thích 401/403/404/409/422/503, code/message/issues/requestId. Validation thiếu trường/minh chứng dùng path values.key/attachments.key.

Giao diện sinh viên có xem lại, xác nhận nội dung đã lưu và nút Gửi hồ sơ; lỗi giữ nội dung, kết quả không chắc chắn yêu cầu tải lại trạng thái trước khi thử tiếp. Đã gửi không có điều khiển sửa/tải/gỡ hoạt động. Cán bộ có danh sách, đọc hồ sơ/minh chứng và nút Nhận xử lý, tải lại khi conflict. Dùng cùng thiết kế và nhãn tiếng Việt hiện có, hỗ trợ bàn phím và mobile.

## Chưa triển khai

Chưa duyệt/từ chối/yêu cầu bổ sung, phân công lại, thông báo email, chữ ký số/ảnh dấu đỏ có hiệu lực, sinh văn bản, trả kết quả hay production. SignatureStatus tiếp tục NOT_CHECKED. Kho local còn các giới hạn đã công bố trong ADR 0003. Nghiệm thu và chính sách pháp lý/chữ ký vẫn là bước riêng.

## Kiểm chứng

Integration kiểm tra đủ/thiếu thông tin và tệp, profile refresh, routing bị thu hồi, sai scope/ghép role, IDOR/DRAFT ẩn, tự xử lý bị chặn, immutable dữ liệu/tệp, gửi/publish/save/upload race, nhận đồng thời/idempotency, unit/user inactive, retired version, tải byte gốc, Origin và rollback audit. Web kiểm tra xác nhận gửi, dirty/thiếu bị chặn, readonly sau gửi, conflict giữ dữ liệu và hàng đợi/nhận xử lý. Demo trình duyệt dùng DB test riêng; không đổi cấu hình, quyền hoặc thông tin đăng nhập development để tạo demo.