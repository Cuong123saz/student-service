# Mô hình phạm vi dữ liệu

Scope giới hạn tập dữ liệu mà một `user–role` được phép thao tác. Permission trả lời “được làm gì”; scope trả lời “được làm trên dữ liệu nào”. Một request truy cập dữ liệu phải thỏa mãn đồng thời cả hai điều kiện.

## Các loại scope

| Scope | Ý nghĩa |
| --- | --- |
| `GLOBAL` | Toàn hệ thống |
| `FACULTY` | Một khoa và các lớp trực thuộc khoa đó |
| `CLASS` | Một lớp cụ thể |
| `ORGANIZATION` | Một đơn vị hành chính như Phòng Đào tạo hoặc Phòng Công tác sinh viên |

`ORGANIZATION` không tự động cho phép đọc hồ sơ sinh viên. Module nghiệp vụ sau này phải quy định rõ tài nguyên nào thuộc đơn vị nào.

## Cấu trúc dữ liệu

- `authorization_scopes` lưu scope chuẩn hóa; constraint đảm bảo mỗi loại chỉ có đúng target tương ứng.
- `user_role_scopes` gắn scope vào đúng quan hệ `user_roles`, nhờ đó một người có thể giữ cùng một role ở nhiều khoa hoặc lớp.
- `GLOBAL` chỉ có một bản ghi duy nhất.
- Mỗi khoa, lớp hoặc đơn vị chỉ có một bản ghi scope tương ứng để tránh dữ liệu trùng.

## Quy tắc truy cập sinh viên

Actor được truy cập một sinh viên khi:

1. Actor đang ở trạng thái `ACTIVE`.
2. Một role của actor có permission được yêu cầu.
3. Chính role đó có ít nhất một scope bao phủ sinh viên:
   - `GLOBAL`; hoặc
   - `FACULTY` trùng khoa của lớp sinh viên; hoặc
   - `CLASS` trùng lớp sinh viên.

Scope không thay thế permission và permission không thay thế scope. Khi thiếu một trong hai, hệ thống từ chối theo nguyên tắc deny by default.

## Quy tắc tạo sinh viên

- Route tạo lời mời sinh viên yêu cầu permission `student.create`; tài khoản không phải sinh viên yêu cầu `user.manage`.
- Với sinh viên, lớp đích phải đang hoạt động và được bao phủ bởi scope `GLOBAL`, `FACULTY` hoặc `CLASS` gắn với chính role có `student.create`.
- Repository kiểm tra lại permission và scope trong cùng transaction tạo user, role, hồ sơ, token và audit. Frontend chỉ hỗ trợ chọn đúng lớp, không phải ranh giới bảo mật.
- Cập nhật hồ sơ yêu cầu `student.update`. Actor phải có quyền trên cả lớp hiện tại và lớp đích; lớp đích phải thuộc đúng khoa được gửi lên. Tên, mã sinh viên và lớp được cập nhật trong cùng transaction, còn khoa luôn được suy ra từ lớp để không tạo dữ liệu mâu thuẫn.
- Lớp không tồn tại hoặc ngừng hoạt động trả lỗi dữ liệu `422`; lớp tồn tại nhưng ngoài scope trả `403` chung để không lộ chi tiết phạm vi.
- Khi gửi lại lời mời, tài khoản sinh viên tiếp tục yêu cầu `student.create` và scope bao phủ lớp hiện tại; tài khoản không phải sinh viên yêu cầu `user.manage`. Việc revoke token cũ, tạo token mới và ghi audit chỉ diễn ra sau kiểm tra này trong cùng transaction.

## Quy tắc quản lý cơ cấu và cố vấn

- Mọi thao tác yêu cầu permission `organization.manage` và tài khoản actor đang `ACTIVE`.
- Chỉ `GLOBAL` được tạo khoa; `GLOBAL` hoặc `FACULTY` đúng khoa được tạo lớp.
- Cập nhật khoa, lớp hoặc phân công cố vấn chỉ được thực hiện khi scope `GLOBAL`, đúng `FACULTY` hoặc đúng `CLASS` bao phủ tài nguyên.
- Tạo khoa/lớp tự tạo authorization scope tương ứng. Thay đổi dữ liệu và audit `before/after` nằm trong cùng transaction.
- Đổi cố vấn đóng kỳ phân công hiện tại rồi mở kỳ mới; exclusion constraint ở PostgreSQL tiếp tục chặn hai kỳ `ACTIVE` chồng thời gian trong một lớp.
- Chỉ `GLOBAL` được tạo đơn vị hành chính. Khi tạo, hệ thống đồng thời tạo scope `ORGANIZATION` trong cùng transaction.
- Cập nhật đơn vị hành chính yêu cầu `GLOBAL` hoặc đúng scope `ORGANIZATION`; thay đổi và audit `ORGANIZATIONAL_UNIT_CREATE`/`ORGANIZATIONAL_UNIT_UPDATE` luôn commit hoặc rollback cùng nhau.

## SYSTEM_ADMIN

- Migration gán `GLOBAL` cho các quan hệ `SYSTEM_ADMIN` đã tồn tại.
- Bootstrap gán `GLOBAL` trong cùng transaction khi tạo `SYSTEM_ADMIN` mới.
- Nếu tạo lời mời mang role `SYSTEM_ADMIN`, repository cũng gán `GLOBAL` trong cùng transaction.

Các role còn lại không được tự suy ra scope. Admin phải gán phạm vi tường minh trong màn hình quản lý quyền truy cập.

## Quy tắc gán role và scope

- Mọi thao tác yêu cầu permission `role.manage`; repository kiểm tra lại tài khoản `ACTIVE`, permission và scope trong cùng transaction cập nhật.
- `SYSTEM_ADMIN` chỉ dùng đúng một scope `GLOBAL`; chỉ một `SYSTEM_ADMIN` khác được cấp role này.
- `ADMIN` dùng `GLOBAL`, `FACULTY`, `CLASS` hoặc `ORGANIZATION`; `ACADEMIC_ADVISOR` chỉ dùng `CLASS`; `FACULTY_REVIEWER` chỉ dùng `FACULTY`; `DOCUMENT_SIGNER` chỉ dùng `ORGANIZATION`.
- `STUDENT` không nhận scope quản trị vì chỉ truy cập dữ liệu cá nhân qua user session. Role này phải khớp với sự tồn tại của `student_profiles`, nên màn hình phân quyền không dùng để thêm hoặc gỡ định danh sinh viên.
- Admin không được cấp scope rộng hơn phạm vi gắn với chính role có `role.manage`. Scope khoa bao phủ các scope lớp trực thuộc; scope lớp không bao phủ lớp khác.
- Không cho người quản trị tự thay role/scope để tránh tự khóa tài khoản. Không cho thu hồi `ACADEMIC_ADVISOR` khi người đó còn kỳ phân công cố vấn đang hiệu lực.
- Việc thay toàn bộ role/scope và audit `ROLE_ASSIGNMENT_UPDATE` nằm trong cùng transaction. Audit chỉ lưu mã role và ID scope, không lưu dữ liệu bí mật.
