---
status: Accepted
date: 2026-10-13
scope: Local synthetic demos and user-requested artifact cleanup
---

# ADR0012: Giữ tài liệu của demo giả trong workspace

Theo yêu cầu chủ dự án xóa tệp backup/diễn tập ngoài project và tiếp tục tự thực hiện, các demo vault tạo mới lưu vault dưới run/workflow-demo/UUID/vault, được Git bỏ qua. Ngoại lệ có giới hạn với ADR0010: chỉ APP_ENV=test, parent IPC và entry snapshot/UUID/origin/database giả cố định. Không đổi chính sách kho production hoặc tự coi dữ liệu development có sẵn là dữ liệu giả.

Protected roots của demo là snapshot API, node_modules, evidence và templates. Output/staging vẫn phải tuyệt đối, tách nhau và tách protected roots; giữ mọi kiểm tra ancestor/junction, bounded read/write, hash và wx. Không dùng toàn project làm protected root trong demo giả vì sẽ bao trùm chính run; code snapshot và dependency vẫn được bảo vệ/provenance trước và sau chuyển đổi.

Demo workspace dùng127.0.0.6:3021/API3020, active state riêng. Giữ nguyên kho/metadata/container của demo cũ12d8 đang dừng; không tái khởi tạo tmpfs cũ để giả phục hồi. Checker chỉ được chạy một lần trên UUID mới, giữ DEMO3 cho người dùng. Chưa cấp thêm quyền retry cho ADMIN, không thay startup development mặc định.

Các rehearsal recovery khác chưa đổi vị trí mặc định trong quyết định này; trước khi chạy tiếp phải điều chỉnh vị trí hoặc lựa chọn rõ để không tự tái tạo các kho ngoài project đã xóa.
