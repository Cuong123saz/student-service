# Đóng Sprint 7 — Ký và đối chiếu mô phỏng

Ngày 14/10/2026. **CLOSED kỹ thuật local**, theo ủy quyền “tiếp tục sang sprint 7 nếu đạt yêu cầu” và “tiếp tục”. Sprint 6 đã đạt điều kiện local, bằng chứng và mẫu Word còn nguyên hash. Chủ dự án chưa có biên bản thao tác nghiệm thu riêng; chưa có phê duyệt Học viện. Production **NOT_READY**. [Trạng thái Sprint 7](sprint-7-status.json) tách riêng các sprint trước.

## Kết quả MVP

[ADR0018](adr/0018-mock-signing-workflow.md) được commit trước migration 0025. Luồng một bước sau duyệt nội dung, dùng mock signer và dữ liệu giả; bám [kế hoạch](sprint-7-plan.md). [Hướng dẫn thao tác](sprint-7-mock-signing-guide.md) dành cho cán bộ/sinh viên và người chạy diễn tập.

| Tiêu chí             | Kết quả                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thẩm quyền mô phỏng  | Đúng cán bộ đang nhận hồ sơ, có `document.mock_sign` và `submission.review` cùng role/scope. Catalog có quyền riêng; các vai trò mặc định không tự nhận quyền này.                  |
| Điều kiện ký         | APPROVED, round hiện tại, service/unit/user hoạt động, không tự xét hồ sơ của mình; bản DOCX/PDF đã lưu bất biến. Chưa duyệt, đã từ chối, round cũ và STUDENT_CONFIRMATION bị chặn. |
| Binding và checksum  | Receipt gắn đúng document/submission/round/format/size/SHA-256, actor và revision. Không nhận receipt/hash/path từ client.                                                          |
| Gửi lại và đồng thời | Cùng requestId/binding trả cùng bản ghi; đổi mục tiêu bị409; hai yêu cầu ký đồng thời chỉ có một bản ghi thắng.                                                                     |
| Quyền khi xử lý      | Kiểm tra trước/sau I/O; khóa ngắn trạng thái quyền, gồm bảng roles, và hồ sơ trước ghi. Thu hồi quyền giữa I/O không ghi kết quả.                                                   |
| Đối chiếu            | Owner hoặc reviewer đang có quyền xem đọc receipt/pin tin cậy và byte kho. Tamper được kiểm thử bằng buffer giả ở integration; browser kiểm tra kho đĩa thật và snapshot không đổi. |
| Audit và bất biến    | Receipt/check append-only, trigger kiểm binding/shape và ghi audit cùng transaction; fault audit rollback thao tác ký.                                                              |
| Giao diện            | Panel user/admin, xác nhận rõ trước ký, focus và hủy, giữ requestId khi mất phản hồi, xóa dữ liệu khi đổi hồ sơ/mất quyền. Sinh viên có đối chiếu và lịch sử, không có nút ký.      |
| Ý nghĩa kết quả      | `SIMULATION_MATCH` vẫn `NOT_VERIFIED`, `legalEffect=false`, nhãn **DEMO – KHÔNG CÓ GIÁ TRỊ PHÁP LÝ**. Word/PDF và minh chứng giữ trạng thái chưa xác minh; không cấp văn bản.       |

Giấy xác nhận sinh viên tiếp tục làm trực tiếp tại Phòng CTSV. Word/PDF gốc không thêm hình dấu/chữ ký; kết quả mô phỏng lưu riêng.

## Kiểm chứng tự động

Mã sản phẩm `642d3c4aa1ce00ea3acd32350632f468421c432a`; bản nghiệm thu `eb36be5c849e40f8b4f641abb1bb7e7d6a88c92b` bổ sung guard chẩn đoán không in credential giả. API/Web source giữ nguyên giữa hai commit; browser dùng bản nghiệm thu cuối. Typecheck/lint và build API cuối hoàn tất trên source này.

| Bộ kiểm tra                                 | Kết quả                          | Log trong run/                                                                             |
| ------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| API unit toàn dự án                         | 182 đạt, 1 skip symlink Windows  | sprint7-api-unit-verified-20261014.log                                                     |
| API integration toàn dự án                  | 320 đạt, gồm 13 test workflow ký | sprint7-api-integration-full-20261014.log                                                  |
| Web gồm Nuxt acceptance                     | 131 đạt, 19 file                 | sprint7-web-full-20261014.log                                                              |
| ADR gate                                    | 46 đạt                           | sprint7-adr-tests-20261014.log                                                             |
| Profile/CLI + tương thích mock              | 32 đạt                           | sprint7-profile-guards-20261014.log; sprint7-mock-guard-20261014.log                       |
| Typecheck/lint/build API, build Web, format | Đạt                              | sprint7-{typecheck-closure,lint-closure,api-build-closure,build,format-check}-20261014.log |

Tổng **711 bài đạt, 0 lỗi, 1 skip** trong các lượt cuối. Không cộng lại 7 test panel đã nằm trong 131 test Web. ADR gate thực tế xác nhận tài liệu kiến trúc đã Accepted trước schema.

Lượt Web chuyên biệt ban đầu chưa khởi động được worker, chưa chạy test; lượt kế tiếp 7/7 và toàn bộ Web 131/131 đạt. Lượt API unit đầu có 2 lỗi: deadline startup trả `DOCUMENT_PROCESS_TERMINATION_UNCERTAIN`, sau đó trạng thái quarantine làm test config tiếp theo thất bại. Chạy lại toàn bộ riêng đạt 182/182 và 1 skip, không sửa supervisor hoặc tăng deadline. Chưa kết luận nguyên nhân lượt lỗi; các số đo local không chứng nhận khả năng chịu tải production. Log ban đầu vẫn có trong run/.

## Diễn tập trình duyệt và tài liệu

Run `34c323ba-265a-484c-98d0-cacce900540a` **PASS**, gồm 20 nhóm quy trình cũ và 10 nhóm ký/đối chiếu mới; 40 lượt responsive ở 375/768/1024/1440 px, 0 lỗi JavaScript. Browser/API/PostgreSQL/kho đĩa thật, chỉ dữ liệu giả. Hai receipt ký Word/PDF của round 2, sáu lần đối chiếu qua sinh viên/cán bộ user/admin, tám audit; gửi lại yêu cầu không thêm bản ghi. Snapshot hồ sơ/round/minh chứng/registry và byte sáu tài liệu không đổi.

Ba cặp Word/PDF, sáu job COMPLETE, một attempt/job, không retry. Sáu ZIP kiểm tra hash, manifest và minh chứng đúng round, gồm hồ sơ bị từ chối. Mẫu v1 SHA-256 `9074a0b961cf66b625d4339c4473a42c7bfc3d981816f821fa78552c7fae8ca2`.

Ba Word render độc lập bằng công cụ render_docx dưới supervisor; ba PDF ứng dụng render bằng Poppler. Đủ mười trường, dấu tiếng Việt, 0/Không và 15/Có; chữ nằm trong trang. Ba cặp raster khớp từng pixel ở 110 dpi. Công cụ QA Word ban đầu thiếu LibreOffice trên PATH; bổ sung PATH cho LibreOffice/Poppler rồi render lại đạt cả ba, giữ nguyên deadline 90 giây. Lượt QA đạt có log sprint7-word-qa-verified-20261014.log và sprint7-pdf-qa-20261014.log.

Đã xem trực tiếp 8 ảnh panel mới, bảng tổng quan 12 ảnh baseline và 7 crop đọc rõ, cùng 6 ảnh trang Word/PDF. Một số crop desktop lấy cả thanh điều hướng cố định ở mép trên; heading được xem thêm ở mobile/admin không bị che. Ảnh gốc giữ nguyên. Kết quả ở qa/visual-review.json và qa/pdf-layout-check.json.

Bootstrap converter một lần đạt sau 69,882 giây; mốc khởi tạo API VERSION_AFTER_READY ghi nhận 94,715 giây. Các số đo chỉ thuộc lượt này. Lượt cuối **STOPPED**, container riêng đã gỡ, cổng 3032/3033 không còn listener. Database nguồn và test vẫn dừng. Không coi URL diễn tập là máy chủ đang chạy.

Bằng chứng local trong `run/workflow-demo/34c323ba-265a-484c-98d0-cacce900540a/`:

- browser-report.json: `e6b65e17433756261f47927f9861cf8c02fc2757b4cde46ac053049fc6b0c011`.
- sprint7-browser-report.json: `8cae0fa417b7c5e736b9450d62cd9499dcbae70bcf00a0c7c76fae863bb9a148`.
- sprint7-document-inventory.json: `fda3d21e00c6fa2e99c85b8c2bb1acbec44e06fe72a3cad03c0bfe923c0d7363`.
- qa/visual-review.json: `4d99d8c78938db89487565e4f7aa0fc75e9e96820dbccdd2e2547880233ef1d9`.
- qa/pdf-layout-check.json: `2e6bdb341df3f03310cf5f0bc4ba9eb1c53556482df84cb881911b5ca9c76770`.

Audit tổng hợp: run/sprint7-code-and-evidence-audit-20261014.json. Các log/ảnh/dữ liệu giả ở run/ được bỏ qua bởi Git; trạng thái và tài liệu nghiệm thu được commit.

## Giới hạn và công việc vận hành tiếp theo

Máy chủ mặc định vẫn render tài liệu theo yêu cầu và chưa bật ký mô phỏng. Vault/receipt/check chỉ được kích hoạt bằng dependency injection tại profile Sprint 7 giả riêng, cần parent IPC và từ chối cấu hình nguồn/production. Chưa nâng database development legacy.

MVP chưa dùng chứng thư, khóa ký, nhà cung cấp ký số, thẩm quyền ký thật hoặc phát hành văn bản. Khôi phục bản sao có receipt/check schema mới phải được nghiệm thu riêng; không coi recovery v2 cũ đã bảo vệ hai bảng mới. Kích hoạt vault trên runtime chính, backup khác thiết bị, quét mã độc/retention, đo tải và UAT Học viện thuộc increment vận hành sau.
