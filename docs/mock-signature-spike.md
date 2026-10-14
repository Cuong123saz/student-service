# Bộ ký mô phỏng và kiểm chứng Word/PDF

Adapter `SignatureProvider`/`MockSignatureProvider` dành cho dữ liệu giả; receipt luôn ghi “DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ”. Kết quả đối chiếu `SIMULATION_MATCH` vẫn giữ `technicalSignatureStatus: NOT_VERIFIED`, `legalEffect: false`. File Word/PDF gốc không bị sửa hoặc nhúng ảnh dấu. Đây là spike kỹ thuật; chưa hoàn tất ký theo workflow, quyền ký/ban hành hoặc toàn bộ Sprint 7.

## Cách chạy

Dùng Node22, Docker Desktop và LibreOffice Windows. Dựng API/Web trước, đặt LIBREOFFICE_PATH tuyệt đối đến soffice.com, cài Playwright/Chromium; có thể đặt WORKFLOW_PLAYWRIGHT_MODULE/WORKFLOW_CHROMIUM_EXECUTABLE khi dùng runtime riêng.

```powershell
npm run build
npm run rehearse:mock-signature:workflow --workspace @student-service/api
```

Lệnh tạo run và database tmpfs mới; cổng `.8:3024/3025` phải trống. Trước mở API, chuẩn bị profile LibreOffice bằng mẫu giả, tối đa hai lượt bootstrap có giám sát, mỗi lượt90s. Chỉ thử lại sau timeout với bằng chứng đã thu hồi hết process. Manifest khóa binary/hash/size/đường dẫn các file profile; các cache rỗng cũng được giữ. Mỗi request chép đúng byte sang profile tạm riêng; request PDF vẫn có hạn90s và tối đa hai tác vụ. Không sử dụng profile Office cá nhân hoặc sửa môi trường demo cũ. Xem [ADR0015](adr/0015-synthetic-converter-profile.md).

Trình duyệt thật thực hiện gửi, bổ sung, quyết định nội dung, tải Word/PDF/ZIP và kiểm tra quyền. Sau đó adapter compiled đọc registry qua transaction READ ONLY, đối chiếu byte kho với file tải, thử receipt trên hai định dạng/hai round. Tệp, round, actor hoặc receipt bị sửa phải bị phát hiện. Audit mô phỏng ghi riêng; hồ sơ/registry/audit nghiệp vụ không chuyển thành đã ký hoặc đã ban hành.

Lượt xong tự dừng server và xóa đúng container của mình. Báo cáo, receipt và audit thử lưu dưới project/run, Git bỏ qua. `run/workflow-mock-signature-demo-active.json` trỏ lượt môi trường; `mock-signature-result.json` trỏ báo cáo trong `run/mock-signature/<run-id>/report.json`. Checker riêng yêu cầu parent IPC; không chạy lại checker trên lượt đã dùng. Chạy lệnh trên tạo lượt mới.

## Bằng chứng hiện tại

Ngày 14/10/2026: adapter11/11, profile10/10 (cache rỗng, pin/tamper, traversal/duplicate/giới hạn, junction, target độc lập, cleanup/capacity), rào chắn CLI2/2 đạt. Rào chắn profile demo17/17 đạt ở lượt trước. Hồi quy API cuối đạt181 bài/1 skip symlink Windows/0 lỗi, gồm11 adapter và10 profile; không cộng lại hai tập này. Log `run/mock-signature-api-unit-complete-20261014.log`. Typecheck/build profile đạt. Lượt toàn luồng cuối **PASS**: workflow run `9da75d18-5e7a-4f84-9599-3c914f68b0b4`, mock run `f6194ce5-539c-43a9-8ca1-2cbd0a51a932`. Browser19 nhóm/24 responsive/0 lỗiJavaScript; adapter7 nhóm trên4 tài liệu,12 event audit mô phỏng. Registry và file nguồn không đổi sau kiểm chứng. Profile135 file/676697byte; bootstrap thành công lần1 trong80.462s; readiness PDF53.302s, native EXITED/empty=true.

Đã dựng hai Word bằng renderer được cung cấp và hai PDF tải thật bằng Poppler; đã xem đủ4 ảnh, mỗi tài liệu1 trang, không cắt chữ/chồng lấn/mất dấu. Nội dung text của PDF ứng dụng và PDF dựng độc lập từ Word khớp sau chuẩn hóa khoảng trắng. Số0/false lần1 và15/true lần2, ngày/chọn lựa/minh chứng đúng round. Không sửa templatev1 hoặc byte gốc.

`run/mock-signature-completion-audit-20261014.json` ghi7 nhóm/4 document/12 audit, stateSTOPPED và container đã xóa; SHA-256 của report `67a9179ff0c3c5e453f0fa982f64ee5b0736fb6cbd563b171d1cd5e4b047231f`. Artifact trong `run/mock-signature/f6194ce5-539c-43a9-8ca1-2cbd0a51a932/` và `run/workflow-demo/9da75d18-5e7a-4f84-9599-3c914f68b0b4/qa/`; log `run/mock-signature-workflow-verified-20261014.log`, `run/mock-signature-word-qa-final-20261014.log`.

Các container development5433/test5434/demo workspace cũ đều exited lúc kiểm toán14/10. Docker đã dừng trước khi diễn tập mới; không khởi động lại/reset database tmpfs của demo cũ. Login200 của runtime cũ không chứng minh nghiệp vụ hoạt động; báo cáo này chỉ khẳng định lượt mới đã được kiểm chứng.

Các lượt trước đã phát hiện timeout khi PowerShell đóng owner và cold profile LibreOffice. Đã phân biệt deadline converter với owner teardown10s; VERSION30s dựa trên số đo, PDF90s giữ nguyên. Thử tắt Skia/OpenGL không khắc phục; cảnh báo Python vẫn có ở lượt thành công nên chưa coi là nguyên nhân. Profile đã khởi tạo chuyển thành công, làm căn cứ chuẩn bị riêng cho rehearsal. [Chẩn đoán supervisor](document-process-supervisor.md) ghi các lần thất bại; không thay chúng bằng thành công giả.

## Phạm vi còn lại

Spike adapter đã đạt toàn luồng và đã xem Word/PDF xuất thật; không ghi nhận hoàn tất toàn bộ Sprint 7. Sprint 4 có [hồ sơ đóng riêng](sprint-4-closure.md). Tích hợp nút ký, scope/quyền ký riêng, registry receipt/verify/audit bất biến và idempotency cần increment Sprint 7. Ký thật cần quy chế, thẩm quyền, chứng thư và nhà cung cấp; chưa triển khai production hoặc sử dụng dữ liệu thật.
