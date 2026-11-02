# Hướng dẫn AI làm việc trong Student Service Portal

Đọc [AI_CONTEXT.md](AI_CONTEXT.md) khi bắt đầu hoặc nhận bàn giao. Tài liệu này ghi mục tiêu dự án, roadmap 13 sprint, trạng thái hiện tại, bước tiếp theo và nguồn kiểm chứng. Đọc tiếp README, plan/status sprint hiện hành và ADR của phần cần sửa.

## Cách cộng tác

- Trả lời tiếng Việt; phản biện và hướng dẫn nghiêm khắc như senior dạy intern. Nêu lỗi, giả định và hệ quả theo bằng chứng; tránh khen chung chung.
- Phân biệt yêu cầu hướng dẫn với thực hiện. Làm tiếp phần người dùng đã cho phép; không hỏi lại cùng một xác nhận. Việc không rõ thì làm phần độc lập có ích trước khi hỏi.
- Không tuyên bố PASS, đã deploy, đã nghiệm thu hoặc đã đóng sprint chỉ vì có code. Nêu chính xác scope, thời điểm và giới hạn kiểm chứng.

## Quy tắc repo

- Theo [quy ước phát triển](docs/development-guidelines.md). Route xử lý HTTP; service nhận dependency; repository giữ SQL/quyền/transaction. Không I/O hoặc chạy converter trong transaction giữ khóa.
- Giữ snapshot bản nộp, lịch sử quyết định và byte minh chứng bất biến; kiểm quyền hiện tại ở server, gồm sau I/O. Giữ riêng điểm tự khai và điểm đã duyệt. Mock signing không phải chữ ký số được xác minh.
- Giấy xác nhận sinh viên vẫn OFFLINE tại CTSV. Tiêu chí A–E là giả định, không tự suy xếp loại chính thức.
- Migration mới cần ADR và kiểm chứng bảo toàn theo gate hiện có; không sửa migration đã áp dụng hoặc tự migrate DB nguồn để chạy thử.
- Thử bằng DB/storage giả riêng, chỉ dọn tài nguyên của lượt mình tạo. Không commit secret, dữ liệu thật, `run/`, `.local/`, dependency/build hoặc tự thêm roadmap Word local.
- Kiểm tra phù hợp thay đổi, không che lỗi bằng bỏ test. Sau increment cập nhật plan/status/hướng dẫn và điểm tiếp tục trong AI_CONTEXT.md; giữ rõ bằng chứng lịch sử.
- Đọc lại Git/remote/nhánh trước commit hoặc push; không dùng trạng thái Git trong tài liệu lịch sử làm dữ liệu live. Tôn trọng các thay đổi hiện có của người dùng.
