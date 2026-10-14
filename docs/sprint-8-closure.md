# Sprint 8 — Hồ sơ đóng kỹ thuật local

**CLOSED ngày 15/10/2026**, theo yêu cầu “sprint 8” và tiếp tục của chủ dự án. Phạm vi đóng là **LOCAL_TECHNICAL**; không ghi nhận nghiệm thu thủ công riêng hoặc phê duyệt của Học viện. Production **NOT_READY**. [Trạng thái máy đọc](sprint-8-status.json), [hướng dẫn sử dụng](sprint-8-training-points.md), [ADR 0019](adr/0019-training-points-foundation.md).

## Kết quả chức năng

Quản trị đủ quyền/phạm vi quản lý đợt theo lớp, năm học và học kỳ; tạo/sửa nháp, xác nhận mở/đóng. Năm nhóm A–E có tổng tối đa 100 điểm; cấu hình và thời hạn cố định khi mở. Mặc định 20 điểm/nhóm là **dữ liệu giả**, cần quy chế được phê duyệt trước khi sử dụng thật.

Sinh viên lưu thiếu thông tin, giữ riêng ô chưa khai và điểm 0, thêm/gỡ/tải minh chứng đúng nhóm, kiểm tra rồi xác nhận nộp. Máy chủ kiểm đủ A–E, giải trình cho điểm dương và minh chứng bắt buộc. Bản nộp chốt thông tin sinh viên, tiêu chí, trả lời, danh sách tệp và tổng điểm; nội dung và lịch sử bất biến. Chuyển lớp hoặc đóng đợt vẫn đọc lịch sử của chính mình.

Quyền hiện tại và scope được kiểm tại máy chủ, kể cả trước/sau đọc ghi tệp. Có revision, requestId chống gửi lặp, transaction và khóa chống ghi đua; audit cùng giao dịch, kiểm SHA-256 khi tải và trước nộp. Tệp PDF/PNG/JPEG có giới hạn loại, dung lượng và số lượng; chữ ký/dấu của minh chứng vẫn **NOT_CHECKED**. Điểm luôn **SELF_DECLARED_NOT_REVIEWED**, chưa có xếp loại chính thức.

## Kiểm chứng

Mã thực thi được diễn tập cuối: `d2c5c06beb4df0525fadcbb36e9014508946abd1`. ADR Accepted đã được commit ở `a0b3825` trước migration 0026; cổng ADR kiểm tra dải `a0b3825..d2c5c06` đạt.

| Nhóm                     |     Đạt | Bỏ qua | Bằng chứng local                                |
| ------------------------ | ------: | -----: | ----------------------------------------------- |
| API unit                 |     185 |      1 | `run/sprint8-api-unit-20261014.log`             |
| API integration          |     337 |      0 | `run/sprint8-api-integration-full-20261014.log` |
| Web, gồm acceptance Nuxt |     139 |      0 | `run/sprint8-web-final-fix-20261014.log`        |
| Cổng ADR                 |      50 |      0 | `run/sprint8-adr-tests-20261014.log`            |
| Guard/profile diễn tập   |      33 |      0 | `run/sprint8-visual-guards-20261014.log`        |
| Tổng                     | **744** |  **1** | Không cộng lặp các lần chạy lại                 |

Các bộ đầy đủ chạy ngày 14/10; sau sửa cuối, 17 kiểm thử integration điểm rèn luyện, 4 acceptance Nuxt và 33 guard được chạy lại, đều đạt. Ba nhóm này đã nằm trong tổng trên. Bài bỏ qua là “private file never follows a file symlink”, do máy Windows không cho tạo symlink thử nghiệm; không coi bài này đã đạt. Log lần chạy lại: `run/sprint8-training-integration-20261014.log`, `run/sprint8-visual-component-tests-20261014.log`, `run/sprint8-visual-guards-20261014.log`.

API typecheck, lint toàn API và lint lại hai tệp API sửa cuối, kiểm tra định dạng theo lệnh dự án và định dạng các tệp sửa cuối, build API/Web và cổng ADR sau commit đều đạt. Chỉ mục bằng chứng lưu SHA-256 của từng log, báo cáo, ảnh đã rà và tệp tải; đây là bằng chứng trên máy local, thư mục `run/` không đưa lên Git.

Diễn tập trình duyệt ngày 15/10 dùng PostgreSQL tmpfs và dữ liệu giả riêng, run `8f55c462-2644-49fc-a176-585b4a9b0bc3`: **14 nhóm chức năng, 20 kiểm tra responsive**, không lỗi JavaScript hoặc tràn ngang. Kiểm các trạng thái cấu hình đợt, danh sách sinh viên, nháp đầy đủ, kiểm tra trước nộp và đã nộp tại 375/768/1024/1440 px. Đã trực tiếp xem 10 ảnh ở 375 và 1440 px qua bản ghép đầy đủ chiều cao; ảnh điện thoại giữ nguyên kích thước, desktop thu 80%. Minh chứng nằm cạnh đúng nhóm, tải được khi nội dung khóa; bước xác nhận và lịch sử đọc rõ.

Trình duyệt kiểm lưu rồi đọc lại điểm 0 và ô trống, chặn nộp thiếu/thiếu minh chứng, tải nguyên byte, gỡ/tải lại minh chứng, từ chối tài khoản khác, khóa nội dung sau nộp và giữ bản nộp khi đóng đợt. Bản nộp diễn tập có revision 7 và 7 sự kiện lịch sử.

Lần chạy trình duyệt đầu dừng vì đường dẫn Chromium trên máy; lần kế tiếp phát hiện lỗi thật: AJV chuyển `null` thành `0` ở schema union. Đã sửa schema điểm nullable để giữ nguyên ô chưa khai, kiểm kiểu đầu vào trước coercion và thêm kiểm thử HTTP lưu/đọc lại/chặn nộp thiếu cùng các kiểu sai. Lần diễn tập cuối dùng mã đã sửa và đạt toàn bộ; các báo cáo thất bại cũ được giữ riêng để truy vết.

## Bằng chứng và bảo toàn

Thư mục: `run/workflow-demo/8f55c462-2644-49fc-a176-585b4a9b0bc3/`.

| Tệp                                          | SHA-256                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `browser-report.json`                        | `d937d9fba1df6d617be345062087c5a8cf4d76b52a62afb0f74d051104b19907` |
| `sprint8-visual-qa.json`                     | `79dadbe79f99d6557458d0d2ad6996decdec5f147249e6bd89449c5e12fa0519` |
| `sprint8-preservation.json`                  | `3e00bb61a3a2aba1a331365c5ad923f5f25ff20343ddd859f37170789691ea42` |
| `sprint8-proof-index.json`                   | `0a7e635a85b0e4f2202a77d33ea9ba81746118189de472b289cd2ed8b5fb9f96` |
| `training-evidence.pdf` tải bằng trình duyệt | `28d7a4fd7965c55a98fa87422d3bbe7913b02767d0c77075313533c6ce61a93d` |

Môi trường diễn tập kết thúc **STOPPED**, container thuộc run đã xóa, cổng 3034/3035 không nhận kết nối. Database nguồn legacy không được khởi động hoặc migrate; source và test container đều dừng. Trạng thái đóng Sprint 2+3, 6, 7 và SHA của ba báo cáo browser/inventory Sprint 7 giữ nguyên. Mẫu Word v1 giữ SHA `9074a0b961cf66b625d4339c4473a42c7bfc3d981816f821fa78552c7fae8ca2`; roadmap Word của chủ dự án giữ nguyên và vẫn untracked. **Giấy xác nhận sinh viên tiếp tục OFFLINE tại Phòng CTSV**; chế độ sinh tài liệu mặc định và mock signing mặc định không đổi.

## Giới hạn và mốc tiếp theo

Sprint 9 bổ sung cố vấn/khoa xét duyệt, quyết định và kết quả chính thức; Sprint 10 xuất Excel, biên bản Word/PDF và ZIP. Không tự suy điểm được duyệt từ điểm tự kê khai, không coi bộ tiêu chí giả là quy chế Học viện.

Trước vận hành thật cần nghiệm thu quy chế/phân công, kiểm tải, quét mã độc, retention và UAT. Backup/restore phải được kiểm chứng lại với bốn bảng điểm rèn luyện mới cùng kho minh chứng; bằng chứng recovery của các sprint trước không tự bao phủ schema mới. Chưa triển khai production hoặc nâng nguồn legacy trong Sprint 8.
