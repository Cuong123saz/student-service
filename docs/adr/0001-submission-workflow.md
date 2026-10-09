---
status: Accepted
date: 2026-10-09
decisionOwner: Project owner
approvedBy: Project owner via conversation
approvedAt: 2026-10-09
---

# ADR 0001 Cấu hình biểu mẫu và đơn vị xử lý

Chủ dự án yêu cầu triển khai màn hình cấu hình biểu mẫu và nơi/người xử lý; xác nhận giấy xác nhận sinh viên hiện được thực hiện trực tiếp tại Phòng Công tác sinh viên. Quyết định ngày 09/10/2026 thay giả định cố vấn xét duyệt trong bản Proposed trước đó. Đây là phê duyệt phạm vi dự án cá nhân trong hội thoại, không phải xác nhận quy trình của nhà trường.

## Phạm vi được triển khai

Admin cấu hình theo từng dịch vụ: đơn vị sở hữu, hình thức ONLINE/OFFLINE/HYBRID, đơn vị xử lý, cán bộ được chỉ định hoặc hàng đợi đơn vị, hướng dẫn liên hệ, trường biểu mẫu và yêu cầu minh chứng. Tạo nháp, kiểm tra, xem trước, publish và clone phiên bản. Không triển khai việc nộp hồ sơ, xét duyệt trực tuyến hoặc sinh/ ký văn bản ở bước này.

Pilot STUDENT_CONFIRMATION dùng OFFLINE và đơn vị CTSV. Sinh viên liên hệ trực tiếp Phòng CTSV; không tạo nhiệm vụ cho cố vấn và không mô phỏng duyệt online. Purpose/recipient là trường mẫu có thể chỉnh, chưa được coi là nội dung chính thức của giấy xác nhận.

## Mô hình dữ liệu và phiên bản

Một bảng procedure_versions lưu service ID integer, owner unit UUID, version number, status, revision, cấu hình JSON có schema, actor và thời gian. Cấu hình chứa toàn bộ form/attachments/routing để lưu và publish nguyên tử. Chưa tách bảng con ở MVP vì không có truy vấn hay vòng đời độc lập; validator TypeBox và validation nghiệp vụ kiểm soát JSON, không dùng JSON tùy ý.

DRAFT → PUBLISHED → RETIRED. Mỗi service tối đa một DRAFT và một PUBLISHED. Publish phiên bản mới retire phiên bản cũ cùng transaction. Nội dung đã publish/retired giữ nguyên; clone tạo ID và version mới. PostgreSQL unique/check/trigger bảo vệ bất biến; write khóa service/aggregate và kiểm tra expectedRevision. Hai người sửa hoặc publish cùng revision chỉ một request thắng, request kia nhận 409.

## Quyền cấu hình và phân công xử lý

service.configure phải đi cùng scope GLOBAL hoặc ORGANIZATION đúng owner trên chính một role assignment của user ACTIVE. FACULTY/CLASS không tự bao phủ cấu hình thủ tục cấp phòng. Chỉ GLOBAL khởi tạo thủ tục cho đơn vị; org admin clone/sửa/publish thủ tục của đơn vị mình và không được chuyển owner hoặc chuyển sang phòng khác.

Đơn vị xử lý phải ACTIVE. Với ONLINE/HYBRID, cán bộ được chỉ định hoặc ít nhất một người trong hàng đợi phải ACTIVE và có submission.review cùng scope GLOBAL/ORGANIZATION đúng đơn vị trên cùng role assignment. Không cấp quyền tự động cho ADMIN, không đổi catalog grant mặc định. Cấu hình không cấp quyền đọc toàn bộ student_profiles cho ORGANIZATION; quyền xử lý hồ sơ cụ thể và runtime thuộc các sprint sau.

OFFLINE chỉ xác định nơi liên hệ trực tiếp; không yêu cầu fake reviewer hay tạo queue online. Đối với cán bộ cụ thể được chọn, vẫn kiểm tra quyền/scope, nhưng OFFLINE mặc định phân công nội bộ tại đơn vị.

## Biểu mẫu và minh chứng

Fields có key, label, type, source PROFILE/STUDENT_INPUT, required và options cho SELECT. Type: TEXT, TEXTAREA, NUMBER, DATE, SELECT, BOOLEAN. PROFILE allowlist: studentCode/fullName/classCode/facultyCode; giá trị thật do server lấy khi triển khai nộp hồ sơ, không tin dữ liệu client. Key ổn định, không trùng; tối đa 50 field, 100 option SELECT; không HTML, script hoặc code do admin nhập.

Yêu cầu minh chứng cấu hình key/label/required, MIME PDF/PNG/JPEG, tối đa 3 file, tối đa 5 MiB/file; tổng giới hạn hồ sơ 20 MiB. Bước hiện tại không có upload thật hoặc lưu file. Field mẫu hiển thị là dữ liệu giả trong preview.

## API và trải nghiệm

API admin trả catalog service/unit/cán bộ phù hợp, list version theo scope, create/clone, update aggregate, validate và publish. Validation request/response; lỗi theo path; 401/403/404/409/422 có mã và request ID.

Public chỉ trả cấu hình PUBLISHED của service ACTIVE, tên đơn vị/hướng dẫn và fields, không identity cán bộ, owner nội bộ hay audit. Hướng dẫn OFFLINE xem được không cần login vì không có dữ liệu hồ sơ. Detail service OFFLINE hướng dẫn liên hệ trực tiếp, không dẫn sinh viên sang nộp online.

Màn hình quản trị có nhãn tiếng Việt, preview, trạng thái nháp/đã áp dụng, lỗi gần trường và giữ nội dung khi conflict. ONLINE/HYBRID được mô tả là cấu hình cho luồng tương lai; không có nút nộp khi runtime chưa được triển khai.

## Transaction, audit và kiểm thử

Create/update/publish và audit SUCCESS cùng transaction; audit lỗi rollback nghiệp vụ. Audit chỉ ID, revision, trạng thái và checksum cấu hình; không nội dung field sinh viên, token hoặc object metadata lồng.

Test unit: schema, key/options/source, offline/online validation. Integration PostgreSQL: scope cùng role, từ chối ngoài đơn vị, user inactive, immutability, clone, revision race, publish race và rollback audit. Route test 401/403/validation. Web test cấu hình/publish/preview/hiển thị OFFLINE. API/Web typecheck/test/build theo cổng dự án.

ADR Accepted phải có commit riêng trước migration. Thay đổi cấu trúc hoặc routing runtime ở Sprint 5–6 cần bổ sung đặc tả trước triển khai; không coi việc lưu cấu hình là đã thực hiện xét duyệt.

## Tham chiếu

- [Kế hoạch Sprint 4](../sprint-4-plan.md)
- [Scope](../data-scope-model.md)
- [Ma trận quyền](../authorization-matrix.md)
