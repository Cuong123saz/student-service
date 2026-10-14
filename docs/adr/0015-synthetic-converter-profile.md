---
status: Accepted
date: 2026-10-14
scope: Isolated synthetic signature rehearsal only
---

# ADR 0015: Chuẩn bị profile converter riêng cho diễn tập giả

Mục tiêu tiếp tục yêu cầu kiểm chứng Word/PDF và mock signer. Windows cold profile vượt90s trong khi cùng profile đã khởi tạo chuyển được và thu hồi empty=true. Cảnh báo Python vẫn xuất hiện ở lượt thành công, nên chưa kết luận nó gây lỗi. Không dùng PDF sinh từ lượt timeout làm tài liệu được công bố.

Chuẩn bị profile bằng tài liệu mẫu giả trước khi mở API của profile mock-signature. Tối đa hai lần bootstrap, mỗi lần90s có supervisor/job; chỉ thử lần hai khi lỗi timeout kèm bằng chứng cây process đã rỗng. Lượt thành công phải EXITED/empty=true và PDF có cấu trúc hợp lệ. Không tăng ngân sách90s của request tạo PDF hoặc reset attempts trong registry.

Sau bootstrap, lập manifest bất biến gồm SHA-256 của converter binary và mọi file profile được chọn, kích thước/đường dẫn tương đối. Bỏ lock tạm; giới hạn512 file,4MiB/file,32MiB tổng; cấm symlink/junction/traversal. Chép profile vào runtime riêng; manifest là metadata trong build provenance. API kiểm tra binary/manifest, mỗi tác vụ chép đúng byte manifest sang profile tạm mới và kiểm lại hash. Không dùng chung profile đang chạy giữa hai tác vụ, không đọc profile cá nhân của người dùng.

LibreOfficePdfConverter nhận hook chuẩn bị profile nội bộ tùy chọn. Chỉ fake profile mock-signature cung cấp hook này; server mặc định, development và demo cũ chưa bật. Thất bại chuẩn bị không chạy converter; cleanup/quarantine, giới hạn hai tác vụ, quyền tải và byte Word/PDF bất biến giữ nguyên. Đây là thiết lập môi trường thử, không hoàn tất hardening/recovery profile cho production.

Kiểm chứng: manifest/binary/file bị sửa, path/symlink/giới hạn bị từ chối; hai target độc lập; bootstrap timeout chỉ retry khi đã reaped; hook thất bại giữ nguyên Word và không chạy converter; trình duyệt/API/registry/vault thật xuất hai cặp Word/PDF và mock adapter đối chiếu receipt/round/hash. Giữ STUDENT_CONFIRMATION OFFLINE tại CTSV.
