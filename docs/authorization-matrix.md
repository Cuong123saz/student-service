# Ma trận phân quyền mặc định

Tài liệu này là nguồn đối chiếu cho catalog RBAC hệ thống. Catalog hiện có 6 role, 14 permission và 31 grant mặc định trên tổng số 84 tổ hợp có thể có.

| Permission | SYSTEM_ADMIN | ADMIN | STUDENT | ACADEMIC_ADVISOR | FACULTY_REVIEWER | DOCUMENT_SIGNER |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| `student.read` | ✓ | ✓ | — | ✓ | ✓ | — |
| `student.create` | ✓ | ✓ | — | — | — | — |
| `student.import` | ✓ | ✓ | — | — | — | — |
| `student.export` | ✓ | ✓ | — | — | — | — |
| `user.manage` | ✓ | ✓ | — | — | — | — |
| `role.manage` | ✓ | ✓ | — | — | — | — |
| `organization.manage` | ✓ | ✓ | — | — | — | — |
| `audit.read` | ✓ | — | — | — | — | — |
| `service.configure` | ✓ | ✓ | — | — | — | — |
| `submission.review` | ✓ | — | — | ✓ | ✓ | — |
| `submission.reject` | ✓ | — | — | ✓ | ✓ | — |
| `document.sign` | ✓ | — | — | — | — | ✓ |
| `training_point.review` | ✓ | — | — | ✓ | — | — |
| `training_point.faculty_approve` | ✓ | — | — | — | ✓ | — |

## Quyết định bảo mật

- `audit.read` mặc định chỉ thuộc `SYSTEM_ADMIN` vì audit log có thể chứa IP, actor, mục tiêu và trạng thái trước/sau của thao tác nhạy cảm.
- Chỉ `SYSTEM_ADMIN` đang `ACTIVE`, có `role.manage` và scope `GLOBAL` mới được thay đổi ma trận role-permission. Route guard kiểm tra permission và repository kiểm tra lại toàn bộ điều kiện trong transaction.
- Quan hệ permission của `SYSTEM_ADMIN` được khóa, không chỉnh qua API để tránh tự loại bỏ quyền quản trị nền tảng. Thay đổi role khác ghi audit `ROLE_PERMISSION_UPDATE` với danh sách mã quyền trước/sau.
- Backend kiểm tra permission từ database ở mỗi request và chỉ chấp nhận user có trạng thái `ACTIVE`. Vì vậy việc khóa tài khoản hoặc thu hồi grant có hiệu lực ngay, kể cả khi JWT cũ chưa hết hạn.
- Chưa dùng cache permission. Truy vấn hiện đi qua khóa chính/unique/index, còn quy mô local và ưu tiên hiệu lực thu hồi tức thời. Chỉ thêm cache sau khi có số đo hiệu năng; nếu thêm phải có TTL ngắn hoặc cơ chế invalidation rõ ràng.
- Migration và seed chỉ thêm grant mặc định còn thiếu bằng cơ chế conflict-safe. Chúng không xóa grant đã được cấu hình thủ công. Việc thu hồi hoặc thay đổi catalog phải dùng migration riêng, có review rõ ràng.
- Nếu `SYSTEM_ADMIN` bị khóa nhầm, dùng script recovery có xác nhận tường minh `RECOVER_ADMIN_STATUS=true`; script không tự kích hoạt tài khoản theo mặc định.

## Quy tắc thay đổi

Khi thêm hoặc bỏ permission mặc định, phải cập nhật đồng thời:

1. `authorization.constants.ts`.
2. Migration tương ứng.
3. Bảng ma trận này.
4. Test tổng số grant và các quyền nhạy cảm.
