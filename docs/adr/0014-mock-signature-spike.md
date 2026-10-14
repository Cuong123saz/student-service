---
status: Accepted
date: 2026-10-14
scope: Local technical continuation; synthetic data only
---

# ADR 0014: Spike bộ ký mô phỏng trên byte bất biến

Thực hiện mục tiêu kiểm chứng Word/PDF và mock signer theo ủy quyền tự phát triển. Quyết định kỹ thuật này không chứng minh thẩm quyền ký hoặc hoàn thành toàn bộ Sprint7. Giữ ADR0002/0009/0010, STUDENT_CONFIRMATION OFFLINE tại CTSV.

## Quyết định

Thêm interface SignatureProvider và MockSignatureProvider độc lập HTTP/database. Chỉ khởi tạo khi khai báo rõ dữ liệu giả; không bật/import trong server mặc định. Remote/USB provider chưa triển khai. Không tạo khóa/chứng thư, không tự viết mật mã ký, không vẽ dấu hoặc sửa Word/PDF gốc.

Đầu vào là byte cùng binding document/submission/round/format/size/SHA-256 được kiểm chứng. Kết quả là receipt riêng có marker `DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ`, actor giả định, thời điểm và phiên bản provider. Receipt mô phỏng đối chiếu, không nhúng chữ ký số. Verify ràng buộc tài liệu, actor và hash với receipt đã lưu tin cậy bởi caller; receipt không tự chứng minh nguồn tin cậy. SIMULATION_MATCH luôn có technicalSignatureStatus NOT_VERIFIED, legalEffect false; sai byte/binding/receipt trả SIMULATION_MISMATCH hoặc từ chối input. Không có VALID/ISSUED.

Spike đọc duy nhất lượt demo giả có ownership/state/report hợp lệ, inventory và byte được đối chiếu registry thật. Chỉ đọc nguồn; receipt/audit thử/báo cáo ghi create-exclusive vào run mới trong project. Thử DOCX/PDF đủ nội dung, PDF từ đúng Word, byte không đổi; đổi byte/round/actor/receipt bị phát hiện. Audit thử chỉ metadata ID/hash/kết quả và nhãn mô phỏng; không sửa audit nghiệp vụ, hồ sơ, registry hoặc trạng thái chữ ký minh chứng.

## Giới hạn và kiểm chứng

Không cấp quyền ký cho ADMIN/reviewer hoặc biến duyệt thành ban hành. Ký theo workflow, quyền riêng, registry receipt/verify/audit bất biến, idempotency và giao diện cần increment Sprint7 cùng ADR/schema/test riêng. Chữ ký thật còn cần quy chế và nhà cung cấp.

Cổng đạt spike: test từ chối chế độ thật, input sai, receipt/tệp/binding bị sửa; đúng byte/round; typecheck/lint/build; adapter compiled chạy trên cả Word/PDF lấy từ vault giả và lưu receipt/audit thử/báo cáo. Đóng Sprint4 dựa trên tiêu chí cấu hình riêng, không nhập số liệu spike vào Sprint4.
