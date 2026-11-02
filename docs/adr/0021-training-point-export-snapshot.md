---
status: Accepted
date: 2026-10-23
scope: Sprint 10.1 internal approved training-point export snapshot
---

# ADR 0021 — Snapshot xuất kết quả điểm rèn luyện

Chủ dự án yêu cầu tiếp tục Sprint 10 sau Sprint 9 CLOSED LOCAL_TECHNICAL. Increment 10.1 cung cấp hợp đồng dữ liệu và truy vấn nội bộ, chưa mở API tải hoặc tạo tệp.

## Quyền xuất

Đề xuất permission riêng không cần thiết ở increment này: snapshot là một cách đọc kết quả trong cùng phạm vi quyền xét duyệt hiện có. Cố vấn cần ACADEMIC_ADVISOR + training_point.review trên cùng role, scope phù hợp và phân công lớp còn hiệu lực. Khoa cần FACULTY_REVIEWER + training_point.faculty_approve trên cùng role và scope khoa/toàn hệ thống phù hợp. Tái sử dụng training_review_allowed của ADR 0020. SYSTEM_ADMIN chỉ có permission không thay vai trò nghiệp vụ. Sinh viên không được đọc bảng cả lớp. Không thay catalog hoặc migration trong 10.1.

Nếu sau này cần thu hồi quyền tải độc lập với quyền xem xét duyệt, thêm permission riêng bằng ADR/migration trước khi đổi hợp đồng. Không suy ra quyền xuất từ student.export.

## Snapshot và tính nhất quán

TrainingReviewRepository.exportSnapshot đọc metadata đợt, các bản APPROVED và thống kê trong một transaction REPEATABLE READ READ ONLY. Điểm do quyết định FACULTY_APPROVED cuối cùng cung cấp, cố vấn được lấy qua parent_decision_id của chính quyết định đó. Không dùng vòng cố vấn cũ hoặc điểm tự kê khai thay kết quả duyệt. Bản nháp không tham gia thống kê; bản chưa duyệt chỉ tham gia các số đếm, không xuất thành hàng điểm 0.

DTO có schemaVersion, UUID snapshotId, capturedAt UTC từ transaction_timestamp của DB, người xuất, đợt/lớp, tiêu chí, thống kê và hàng kết quả. SnapshotId chỉ là nhận dạng lượt đọc trong bộ nhớ, chưa phải ID tra cứu lại hoặc tệp bất biến được lưu bền vững. Mỗi hàng giữ mã/tên/lớp sinh viên từ student_snapshot, điểm tự khai riêng, điểm đã duyệt A–E và hai receipt xác nhận. Receipt giữ actor snapshot, thời điểm, revision, ID và mã băm. Metadata lớp/khoa là nhãn hiện tại của lớp gắn với đợt; student snapshot giữ nhãn tại lúc nộp kể cả khi sinh viên chuyển lớp. Không trả storage key, đường dẫn tệp, mật khẩu, evidence hoặc lịch sử toàn bộ.

Sắp xếp theo studentCode COLLATE C rồi declarationId, giữ mã số 0 đầu như chuỗi. Tối đa 1.000 bản APPROVED; quá giới hạn trả 422 TRAINING_EXPORT_TOO_LARGE, không cắt âm thầm. Giới hạn thời gian truy vấn transaction là 10 giây. Số hàng phải bằng số approved của thống kê; sai lệch trả 409 TRAINING_EXPORT_INTEGRITY.

TrainingExportService.capture kiểm tra lại quyền bằng transaction mới sau khi đọc snapshot để thấy quyền/phân công vừa bị thu hồi. Đây là điểm vào cho các increment xuất sau. Khi có I/O sinh tệp, còn phải kiểm quyền sau I/O ngay trước trả byte; capture không tự bảo vệ một lần tải diễn ra về sau. Không giữ transaction hoặc khóa khi sinh tệp/converter. Snapshot nội bộ không ghi audit download vì chưa có lượt tải; API tải sau phải ghi audit theo kết quả thực tế.

## Giới hạn và kiểm chứng

Luôn NOT_ASSIGNED về xếp loại, NOT_VERIFIED về chữ ký số, legalEffect=false và nhãn dữ liệu thử nghiệm. Không tự chứng nhận tiêu chí giả là quy chế chính thức.

Kiểm chứng SQL trên database test riêng: trống/nháp/chưa duyệt, trộn trạng thái, điểm 0, vòng trả về/xác nhận mới, thông tin snapshot sau chuyển lớp/đổi tên, scope/phân công/role hiện tại và duyệt xen giữa đọc hàng/thống kê. Unit service kiểm việc không trả snapshot sau thu hồi quyền. HTTP, Excel, Word/PDF/ZIP và diễn tập trình duyệt thuộc các increment tiếp theo.
