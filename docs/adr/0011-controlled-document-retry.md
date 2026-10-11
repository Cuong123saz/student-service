---
status: Accepted
date: 2026-10-11
scope: Local technical continuation; synthetic data
---

# ADR 0011: Mở thêm lượt tạo tài liệu có quyền và nhật ký

Quyết định kỹ thuật theo yêu cầu tiếp tục tự thực hiện. Chưa nghiệm thu sản xuất, chưa cấp quyền ký; giấy xác nhận sinh viên vẫn làm trực tiếp tại CTSV theo cấu hình OFFLINE.

## Giới hạn và lịch sử

Giữ ba lần thử tự động ban đầu. Khi đã hết lượt, người có quyền `document.retry` và `submission.review` trên cùng vai trò, cùng phạm vi hồ sơ hiện tại mới được mở thêm đúng một lần thử. Mặc định chỉ SYSTEM_ADMIN có quyền mới; ADMIN không tự có quyền. Áp dụng đầy đủ tài khoản hoạt động, yêu cầu đổi mật khẩu, đơn vị hoạt động, phạm vi và phân công như xem hồ sơ. Không cho tự xử lý hồ sơ của mình.

Bổ sung `retry_allowance` 0..3 vào job; `attempts` luôn tăng, không reset. Tổng giới hạn = 3 + retry_allowance, tối đa sáu lần. Thêm bảng append-only `submission_document_retries`: request UUID, job, attempt token đã hết lượt, số lần thử, người thực hiện, mã lý do hữu hạn và thời điểm. Một attempt chỉ có một quyết định mở thêm lượt. Chỉ cho thao tác khi RETRYABLE đã hết lượt hoặc RUNNING hết lease và hết lượt; job đang chạy hoặc COMPLETE không được mở thêm lượt. Sau quyết định đợi ít nhất ba giây và vẫn qua quota, claim, token mới và rào chắn công bố cũ.

Mã lý do tương ứng nguyên nhân đã ghi nhận: RENDERER_FIXED, CONVERTER_FIXED, STORAGE_FIXED, WORKER_RESTARTED. Đây là xác nhận kỹ thuật của người vận hành, không phải hệ thống tự chứng minh đã sửa lỗi. Không nhận nội dung tự do chứa câu trả lời hoặc dữ liệu cá nhân.

## Tính nguyên tử và chống yêu cầu lặp

Khóa set rồi job; kiểm tra quyền từ DB trong transaction, kể cả yêu cầu lặp. Thao tác insert retry, tăng allowance và audit USER `document.retry.authorized` là một transaction. Trigger kiểm tra trạng thái, token, quyền/phạm vi và lý do; tăng allowance trần trụi bị từ chối. Audit lỗi thì mọi thay đổi rollback. Cùng request UUID và cùng nội dung trả cùng kết quả, không cấp thêm lượt; UUID dùng lại với nội dung khác bị conflict. Hai người cùng thao tác trên cùng attempt chỉ có một người thành công. Không ghi đè, xóa hoặc tái tạo tài liệu đã công bố, không thay snapshot/mẫu/Word nguồn của PDF.

## Đọc trạng thái và giao diện

Trạng thái tài liệu phải là thao tác đọc, không tạo set/job, không tiêu tốn lượt và không gọi converter. Owner chỉ đọc trạng thái trong hồ sơ của mình; reviewer/admin phải qua quyền/phạm vi hiện tại. Không trả đường dẫn, stderr hoặc chi tiết driver. Người đủ quyền thấy mã lỗi, số lần thử và hành động mở một lượt; yêu cầu thất bại không khiến sinh viên gửi lại hồ sơ. Sau mở lượt, việc tải tài liệu mới thực hiện claim; không chạy converter bên trong transaction.

## Phục hồi và điều kiện mở

Migration mới không sửa 0023. Giữ khả năng đọc backup trước khi có allowance: thiếu trường hiểu là 0; nếu hiện diện phải hợp lệ và không được bỏ qua. Snapshot registry phải gồm các quyết định retry để đối chiếu restore, nhưng đọc snapshot lịch sử phải tương thích cách tính digest cũ khi schema chưa có bảng mới. Inventory không được coi attempts > 3 là hợp lệ nếu thiếu allowance/decision tương ứng. Rehearsal cần thêm tình huống đã hết lượt, cấp thêm, restore rồi chạy tiếp từ cùng Word. Không bật development hoặc demo cũ cho đến khi kiểm thử quyền, race, audit rollback, rào chắn token, bất biến và phục hồi đạt.
