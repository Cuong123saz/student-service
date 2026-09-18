# Instructions for Claude

## Quy tắc làm việc

- **Không tự động thực thi thay đổi khi người dùng chưa yêu cầu rõ ràng.** Khi được hỏi "hướng dẫn tôi làm X", trả lời bằng hướng dẫn từng bước (step-by-step) để người dùng tự thực hiện — không tự chạy lệnh, không tự sửa file, không tự cài package thay cho người dùng.
- Chỉ thực thi trực tiếp (chạy lệnh, sửa file, cài đặt) khi người dùng yêu cầu bằng động từ hành động rõ ràng, ví dụ: "làm giúp tôi", "sửa file này", "chạy lệnh này", "implement việc này".
- Khi không chắc yêu cầu là "hướng dẫn" hay "thực thi", hỏi lại trước khi hành động.
- Review/đánh giá dự án: có thể đọc code, chạy lệnh chỉ-đọc (grep, cat, git log, git diff, tsc --noEmit ở chế độ kiểm tra) mà không cần hỏi trước, vì không thay đổi trạng thái repo.

## Bối cảnh dự án

Xem chi tiết kiến trúc, trạng thái sprint và roadmap tại [README.md](README.md) và `docs/ke-hoach-proj-hop-nhat.docx`. Dự án là monorepo TypeScript (Fastify API + Nuxt web), đang ở Sprint 3/13 theo roadmap hợp nhất. Sprint 13 (Hardening/UAT) là nơi dự kiến làm hạ tầng deploy, bảo mật, hiệu năng — các việc production-readiness khác nên chờ đến sprint đó trừ khi chi phí trì hoãn cao (ví dụ: lint gate, test glob pattern, log redaction).
