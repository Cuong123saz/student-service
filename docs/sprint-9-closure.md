# Sprint 9 — Hồ sơ đóng kỹ thuật local

**CLOSED ngày 23/10/2026**, phạm vi **LOCAL_TECHNICAL**, theo xác nhận “oke” của chủ dự án cho thứ tự khép Sprint 9 trước Sprint 10. Chưa ghi nhận nghiệm thu thủ công độc lập hoặc phê duyệt của Học viện. Production **NOT_READY**. [Trạng thái máy đọc](sprint-9-status.json), [hướng dẫn](sprint-9-training-review.md), [ADR 0020](adr/0020-training-points-review-workflow.md).

## Kết quả

Cố vấn xác nhận điểm và minh chứng; khoa trả về hoặc duyệt; sau trả về, cố vấn lập vòng mới. Quyền, scope và phân công hiện tại được kiểm tại máy chủ. Quyết định append-only, revision/idempotency và audit transaction giữ nguyên bản sinh viên đã nộp. Sinh viên xem riêng kết quả và lịch sử; tổng hợp cấp lớp chỉ tính điểm khoa đã duyệt vào tổng/trung bình.

Diễn tập giữ điểm tự kê khai **15**, điểm khoa duyệt **14**, bốn quyết định liên tiếp; tệp minh chứng tải bằng trình duyệt giữ SHA-256 `28d7a4fd7965c55a98fa87422d3bbe7913b02767d0c77075313533c6ce61a93d`. Xác nhận bằng tài khoản vẫn NOT_VERIFIED, legalEffect=false; bộ A–E là giả định, chưa suy xếp loại chính thức.

## Kiểm chứng

Báo cáo kiểm thử đầy đủ ngày 23/10 tại `C:\Users\Personal\Documents\ChatGPT\New project\verification-2026-10-23\report.md` ghi **1.065 đạt, 1 bỏ qua, 0 thất bại**; bao gồm 351 integration PostgreSQL và 147 web. Bài symlink bị bỏ qua do quyền Windows. Typecheck API/web, lint API, format và build API/web đạt trong lượt đó.

Sau sửa giao diện cuối: **147 web đạt**, web typecheck/build đạt; checker hợp lệ cú pháp. **21 guard đạt** ở lượt kiểm tra launcher trước lần bổ sung assertion kích thước nút; lượt browser cuối thực thi assertion mới. Các lượt này không cộng trùng vào 1.065 bài baseline. API không đổi trong lượt khép sprint này; không chạy lại toàn bộ API sau thay đổi chỉ ở giao diện/checker.

Run trình duyệt cuối `7c29e286-1eeb-4cd7-87cd-9125a3191717`: **14 nhóm chức năng**, **16 kiểm tra responsive** tại 375/768/1024/1440 px, không lỗi JavaScript hoặc tràn ngang. Kiểm nút/link thao tác cao tối thiểu 44 px, xác nhận checkbox, tải tệp thật, chống bỏ qua cố vấn, hồ sơ ngoài scope, vòng trả về/xác nhận lại/duyệt, retry và khóa kết quả cuối, kết quả sinh viên, tổng hợp lớp, chữ lớn/ngang màn hình và reduced motion. Trực tiếp rà toàn chiều cao 4 ảnh gốc qua bản chia ô, gồm hàng đợi, xác nhận, lịch sử và kết quả sinh viên. Ảnh ngang chữ lớn đã xem nhưng cắt cuối lịch sử, không tính vào số ảnh rà toàn trang; kiểm tràn ngang tự động đạt. Định dạng các tệp sửa cuối và git diff --check đạt.

## Lỗi đã phát hiện và sửa

Hai trang xét duyệt thiếu stylesheet khi mở trực tiếp: trang hiển thị thô và tràn ngang ở 375 px. Đã nạp `training.css` trên cả danh sách/chi tiết. Rà ảnh tiếp tục phát hiện nút dùng class không có style chung: chuyển sang BaseButton và bổ sung style link điều hướng. Checker lưu ảnh/thông tin phần tử gây tràn trước assertion, đồng thời kiểm chiều cao nút để bắt lỗi hồi quy.

Hai run lỗi `0ea0f94f-71cb-4153-b6ee-fa3de8f7f100` và `74fc2411-51cf-40aa-b538-a8941d87d34f` được giữ nguyên. Run `6671b75d-e0c8-4c6b-8e15-4388ee053509` đạt chức năng nhưng rà ảnh phát hiện nút nhỏ; bằng chứng đóng dùng run cuối sau sửa nút.

## Bằng chứng và bảo toàn

Thư mục local: `run/workflow-demo/7c29e286-1eeb-4cd7-87cd-9125a3191717/`. `sprint9-proof-index.json` lưu hash báo cáo, ảnh, bản ghi nguồn runtime và log kiểm chứng; `sprint9-preservation.json` kiểm hash trạng thái sprint cũ, bằng chứng Sprint 7/8, mẫu Word và roadmap. Các hash đều khớp; mẫu Word vẫn `9074a0b961cf66b625d4339c4473a42c7bfc3d981816f821fa78552c7fae8ca2`.

Head nền `11be64facdda1345acc67b3e8052096c5789d85a` kèm working tree chưa commit; hash từng tệp runtime nằm trong `sprint9-runtime-manifest.json`. Không dùng HEAD đơn lẻ làm nhận dạng toàn bộ bản đã thử. Chưa commit/push. Môi trường giả cuối STOPPED, container thuộc run đã xóa, cổng 3036/3037 không lắng nghe; database nguồn và test đều dừng, xác minh trong sprint9-environment.json. Không nâng/migrate nguồn development/legacy. Giấy xác nhận sinh viên tiếp tục OFFLINE tại CTSV.

## Mốc kế tiếp

[Sprint 10](sprint-10-plan.md): Excel và biên bản Word/PDF/ZIP từ kết quả đã duyệt. Quy chế chính thức, UAT, deploy, chứng thư ký thật và kiểm chứng backup/restore schema review mới nằm ngoài hồ sơ đóng này.
