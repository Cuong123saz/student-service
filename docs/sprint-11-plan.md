# Sprint 11 — Hoạt động ngoại khóa, CLB và chứng nhận tham gia

**PLANNED — chủ dự án duyệt ngày 02/11/2026 (“đồng ý hết”).** Tiền đề: [Sprint 10 đóng kỹ thuật local](sprint-10-closure.md). Quyết định trong tài liệu này lấy từ trao đổi với chủ dự án ngày 02/11/2026. Production NOT_READY.

## Mục tiêu

Sinh viên đăng ký và tham gia hoạt động ngoại khóa do nhà trường hoặc CLB tổ chức; tham gia được xác minh bằng QR + ảnh tại chỗ và người duyệt; hệ thống cấp **chứng nhận tham gia** và dùng các chứng nhận trong kỳ để **gợi ý** điểm rèn luyện cho bản kê khai. Cố vấn và khoa vẫn duyệt điểm như Sprint 9.

## Actor và quyền

| Actor | Làm được | Không được |
| --- | --- | --- |
| CTSV | Tạo/duyệt và quản lý CLB (gán người phụ trách, tạm dừng, giải thể); tạo hoạt động bắt buộc; giao CLB thực hiện; xem mọi hoạt động; tạm dừng hoạt động CLB; thu hồi chứng nhận | Tự duyệt lượt tham gia của chính mình |
| Phòng Đào tạo | Tạo hoạt động bắt buộc trong phạm vi được gán; giao CLB thực hiện | Quản lý CLB |
| Người phụ trách CLB | Tạo hoạt động **tự nguyện** cho CLB đang hoạt động; duyệt yêu cầu hủy và lượt tham gia của hoạt động CLB mình chủ trì hoặc được giao | Đánh dấu “bắt buộc”; sửa thời gian/đối tượng của hoạt động được giao; tự duyệt lượt tham gia của chính mình |
| Sinh viên | Xem, đăng ký, yêu cầu hủy, điểm danh hoạt động mình thuộc đối tượng; xem chứng nhận của mình | Thấy/đăng ký/điểm danh hoạt động không thuộc đối tượng |

Quyền kiểm tại máy chủ theo role + permission + scope hiện có (`GLOBAL`/`FACULTY`/`CLASS`/`ORGANIZATION`). CLB là một đơn vị tổ chức, dùng lại scope `ORGANIZATION`. SYSTEM_ADMIN không tự thay vai trò nghiệp vụ.

**Đã chốt:** Sprint 11 chỉ để CTSV tạo CLB trên hệ thống sau khi đã duyệt bên ngoài; chưa có luồng sinh viên gửi đề nghị lập CLB.

## Quy tắc nghiệp vụ đã chốt

**Hoạt động.** Có cấp tổ chức (Học viện / khoa / đơn vị / CLB) và điều kiện đối tượng (khoa, lớp, đơn vị, niên khóa). Hai loại:

- **Bắt buộc:** chỉ CTSV hoặc Phòng Đào tạo tạo; đơn vị tạo là chủ hoạt động; có thể giao một CLB thực hiện. Việc giao được ghi lại, chỉ áp dụng cho hoạt động đó, chủ hoạt động rút lại được bất cứ lúc nào.
- **Tự nguyện:** CLB đang hoạt động tự mở, không cần duyệt trước. CTSV xem, tạm dừng và thu hồi chứng nhận khi phát hiện sai; mọi thao tác có audit.

CLB bị tạm dừng/giải thể không mở hoạt động mới; chứng nhận đã cấp giữ nguyên. Không sửa thời gian/đối tượng/sức chứa sau khi đã có người đăng ký mà không ghi lịch sử.

**Đối tượng.** Kiểm ở máy chủ khi xem, đăng ký và điểm danh. Đối tượng được chốt và lưu snapshot **tại lúc đăng ký**. Điều kiện niên khóa dùng **niên khóa của sinh viên** (ví dụ K15; K = năm vào học − 2006), không dùng “năm thứ mấy”: sinh viên học chậm vẫn đúng niên khóa. Sinh viên chưa có dữ liệu niên khóa không đăng ký được hoạt động có giới hạn niên khóa.

**Đăng ký.** Có sức chứa (hoặc không giới hạn) và danh sách chờ. Chống vượt sức chứa khi đăng ký đồng thời bằng khóa dòng trong transaction. Khi chỗ được nhả, người đầu danh sách chờ (theo thời điểm đăng ký) tự lên và nhận thông báo.

**Hủy.** Cả hai loại: sinh viên gửi yêu cầu hủy **trước giờ bắt đầu ít nhất 24 giờ**, kèm lý do; chủ hoạt động (hoặc CLB được giao) chấp nhận hoặc từ chối. Chấp nhận thì nhả chỗ cho danh sách chờ. Yêu cầu chưa được xử lý tới giờ bắt đầu thì **tự coi là chấp nhận** (đã chốt).

**Vắng mặt.** Người đã đăng ký mà không có lượt tham gia được duyệt có trạng thái **Vắng** riêng, khác “không đăng ký” và “hủy được duyệt”. Chưa áp dụng phạt; quy chế phạt sẽ dùng dữ liệu này khi có.

**Điểm danh (một buổi).** Trong khoảng giờ bắt đầu → kết thúc: sinh viên quét **QR in sẵn** của hoạt động bằng camera điện thoại → trang portal mở camera trước để chụp **selfie thấy hội trường hoặc đặc trưng (ban giám khảo, sân khấu)** → lượt tham gia ở trạng thái chờ duyệt → người duyệt chấp nhận/từ chối.

- Camera mở ngay trong trang, không có nút chọn ảnh có sẵn. Máy chủ chỉ nhận ảnh trong vài phút sau lượt quét, từ tài khoản đã đăng ký, mỗi người một lượt mỗi hoạt động. Đồng hồ trên giao diện chỉ để nhắc; luật nằm ở máy chủ (tránh đánh trượt máy chậm và người khuyết tật).
- Tùy chọn cho hoạt động muốn chặt hơn: QR đổi liên tục trên màn hình.
- Ảnh: xóa EXIF, giới hạn loại/kích thước, lưu riêng tư bằng cơ chế lưu tệp đã có, chỉ người duyệt của hoạt động và CTSV xem, có thời hạn xóa; hiển thị thông báo trước khi chụp.

**Chứng nhận tham gia.** Bản ghi do hệ thống cấp khi lượt tham gia được duyệt: mã, hoạt động, sinh viên, người duyệt, thời điểm, hash. Thu hồi được kèm lý do, không xóa. **Không phải văn bằng/chứng chỉ, không có chữ ký số**: `technicalSignatureStatus=NOT_VERIFIED`, `legalEffect=false`. Không nhầm với “Giấy xác nhận sinh viên”, vốn vẫn OFFLINE tại CTSV.

**Gợi ý điểm rèn luyện** (cập nhật 02/11/2026 theo phiếu đánh giá của Học viện, [ADR 0026](adr/0026-academy-criteria-classification-templates.md)). Mỗi loại hoạt động gợi ý vào đúng mục của phiếu:

| Loại hoạt động | Mục phiếu | Quy tắc gợi ý (mặc định) |
| --- | --- | --- |
| Hoạt động do Học viện tổ chức/điều động (bắt buộc + tự chọn) | III.3.1 (nhóm C) | **Đầy đủ** = có chứng nhận đủ mọi hoạt động bắt buộc thuộc đối tượng → **+3**; **tích cực** = đầy đủ và thêm hoạt động tự chọn → **+5**; thiếu bắt buộc → 0 |
| Câu lạc bộ, hoạt động học thuật/ngoại khóa | I.1.4a (nhóm A) | Tham gia → **+3**; thành viên ban tổ chức → **+2** |
| Hiến máu, tình nguyện, công tác xã hội | IV.4.5 (nhóm D) | Tham gia → **+5** |

- Hủy có lý do được chủ hoạt động chấp nhận ở hoạt động bắt buộc được tính như đã tham gia. Kỳ không có hoạt động bắt buộc: có cho mức “đầy đủ” hay không là cấu hình theo đợt (mặc định có, quyết định của chủ dự án; mâu thuẫn với nguyên tắc “không tham gia → 0” đã ghi nhận).
- **Thiết lập theo đợt, không viết cứng**: loại hoạt động → nhóm tiêu chí, mức điểm, số hoạt động tự chọn tối thiểu cho mức tích cực, khoảng thời gian tính. Người quản lý đợt sửa trên trang quản trị, có kiểm hợp lệ (nhóm có trong bộ tiêu chí, điểm không vượt tối đa của nhóm) và audit. Đổi thiết lập không sửa bản kê khai đã nộp.
- Chỉ là **gợi ý** kèm chứng nhận làm minh chứng; cố vấn/khoa vẫn duyệt như Sprint 9. Thu hồi chứng nhận không sửa ngược bản đã nộp hay điểm đã duyệt.
- Cột “do tập thể đánh giá” trên phiếu đã bị trường bỏ, không làm.

## Thứ tự thực hiện

| Increment | Đầu ra | Điều kiện nghiệm thu |
| --- | --- | --- |
| 11.0 — COMPLETE_LOCAL | [ADR 0025](adr/0025-student-cohort.md); migration cột niên khóa (nullable), import Excel/CSV thêm cột “Niên khóa”, hiển thị trong hồ sơ/quản trị | Dữ liệu cũ giữ nguyên; giá trị sai bị báo lỗi theo dòng; không suy niên khóa từ mã sinh viên/lớp |
| 11.1 — CLB và vai trò | [ADR 0029](adr/0029-clubs-and-activity-roles.md); role/permission CTSV, Phòng Đào tạo, người phụ trách CLB; CLB là đơn vị tổ chức; trạng thái CLB | Đúng ma trận quyền; SYSTEM_ADMIN không thay vai trò; audit |
| 11.2 — Hoạt động | ADR + migration; tạo/sửa/hủy hoạt động, bắt buộc/tự nguyện, đối tượng, sức chứa, giao CLB, tạm dừng | Chỉ CTSV/Phòng ĐT tạo bắt buộc; lịch sử thay đổi; đối tượng kiểm ở máy chủ |
| 11.3 — Đăng ký | Đăng ký, danh sách chờ, yêu cầu hủy, vắng mặt, thông báo | Không vượt sức chứa khi đồng thời; danh sách chờ đúng thứ tự; hạn 24 giờ |
| 11.4 — Điểm danh và chứng nhận | QR, chụp ảnh trong trang, xóa EXIF, hàng duyệt, cấp/thu hồi chứng nhận | Từ chối ngoài giờ/không đăng ký/không đối tượng; không tự duyệt; ảnh riêng tư |
| 11.5 — Gợi ý điểm | Thiết lập ngoại khóa theo đợt (nhóm nhận điểm, mức điểm, ngưỡng, khoảng thời gian) có audit; tính b/B/t; đính kèm chứng nhận vào bản kê khai | Không sửa bản đã nộp/điểm đã duyệt; các ca biên (B=0, hủy được duyệt, thu hồi) |
| 11.L — Lớp trưởng | ADR + quyền; lớp trưởng tổng hợp phiếu của lớp (giữ vai trò theo quyết định chủ dự án 02/11/2026); xác định chỗ đứng trong quy trình cố vấn → khoa | Không thay quyền cố vấn/khoa; đúng lớp, đúng nhiệm kỳ |
| 11.6 — Giao diện, diễn tập, đóng | Trang CLB/CTSV/sinh viên, `rehearse:sprint11`, runbook, hồ sơ đóng | Diễn tập trình duyệt 375–1440 px với camera giả lập; rà ảnh |

Mỗi increment có ADR trước khi đổi schema/quyền, test theo quy ước hiện có, và cập nhật status/AI_CONTEXT khi xong.

## Ràng buộc kỹ thuật và rủi ro đã chấp nhận

- **QR in sẵn có thể bị chụp gửi qua chat.** Chấp nhận vì selfie phải thấy hội trường và có người duyệt. Ghép ảnh/camera ảo vẫn qua mặt được; người duyệt là lớp chặn cuối. Không tuyên bố “chống gian lận tuyệt đối”.
- **Camera trên web cần HTTPS** (trừ `localhost`). Sprint 11 diễn tập bằng trình duyệt giả lập camera; thử trên điện thoại thật cần môi trường HTTPS, thuộc hạ tầng Sprint 13.
- **Khối lượng duyệt ảnh.** Cần giao diện duyệt nhanh (lưới, duyệt nhiều lượt có xác nhận) để một hoạt động vài trăm người vẫn xử lý được.
- **CLB tự mở hoạt động tự nguyện** có thể bị lạm dụng để lên +5; giảm thiểu bằng quyền tạm dừng/thu hồi của CTSV, audit và cấm tự duyệt.
- **Niên khóa chưa có dữ liệu thật.** 11.0 làm phần lưu trữ/import; dữ liệu do chủ dự án cung cấp sau.

## Ngoài phạm vi

Phạt vắng mặt; luồng sinh viên đề nghị lập CLB; QR/NFC trên ứng dụng di động riêng; nhận diện khuôn mặt hay xác minh vị trí tự động; chữ ký số; quy chế điểm rèn luyện chính thức; Sprint 12 (nghiên cứu khoa học).

## Kết quả increment 11.0 — 02/11/2026

Theo [ADR 0025](adr/0025-student-cohort.md). Migration viết tay `0028_student_cohort.sql`: cột `student_profiles.cohort_year smallint NULL` (năm vào học) + CHECK 2007–2100; không cập nhật dữ liệu có sẵn. Không dùng `drizzle-kit generate` vì snapshot chỉ tới 0024 (0025–0027 viết tay), lệnh sinh ra cả việc tạo lại các bảng Sprint 7–9. ADR gate ánh xạ `student_profiles` → ADR 0025.

Import: cột tùy chọn “Niên khóa” (`K15`/`15`/năm vào học `2021`; `K2021` bị từ chối), tên khác `Khóa học`, `Năm nhập học`, `cohort`, `cohortYear`; cột “Khóa” bị từ chối với mã `IMPORT_AMBIGUOUS_COHORT_COLUMN`. Giá trị sai báo lỗi theo dòng. Tạo mới ghi niên khóa; `OVERWRITE` chỉ ghi khi có giá trị và ghi audit `STUDENT_COHORT_UPDATE` (trước/sau) khi thực sự đổi. Preview lưu trước nâng cấp vẫn đọc được. File mẫu có cột “Niên khóa”. Hồ sơ cá nhân và danh sách sinh viên quản trị hiển thị niên khóa.

Kiểm chứng: typecheck/lint/format/build đạt; ADR gate 52 đạt và đạt so với nhánh có ADR Accepted (trượt đúng thiết kế nếu so với `main` chưa có ADR); unit API 212 đạt / 2 bỏ qua; integration API 360 đạt; storage/recovery/bundle/guard 315 đạt (trước sửa quy tắc K, không liên quan); web 156 đạt. Diễn tập migration trên database giả riêng: áp tới 0027, thêm sinh viên cũ, áp 0028 → dữ liệu cũ giữ nguyên, `cohort_year` = NULL, CHECK từ chối năm ngoài khoảng. Sửa đổi trước merge: quy tắc K = năm vào học − 2006 (chủ dự án chốt). Chưa có dữ liệu niên khóa thật; chưa chạy diễn tập trình duyệt riêng cho 11.0 (gộp vào 11.6). Bước kế tiếp 11.1 — CLB và vai trò.

## Nhóm việc theo mẫu Học viện (A–C) — 02/11/2026

Chủ dự án cung cấp phiếu đánh giá, bảng điểm lớp và biên bản họp lớp thực tế (có dữ liệu cá nhân thật, **không** đưa vào repo). Làm trước 11.1 theo yêu cầu “làm A, B, C trước”; quyết định ở [ADR 0026](adr/0026-academy-criteria-classification-templates.md):

- **A** — Bộ tiêu chí 5 mục của phiếu (20/25/20/25/10) là mẫu mặc định khi tạo đợt; không cần migration. Chưa chấm theo mục con.
- **B** — Xếp loại tạm tính 6 mức theo mốc chuẩn (`classification-standard-v1`), chưa hạ mức do kỷ luật. File Excel mẫu của trường thiếu mức Trung bình/Kém; hệ thống không sao chép lỗi đó.
- **C** — Bảng điểm lớp theo mẫu trường (`class-sheet.xlsx`, `class-sheet-v1`) và biên bản họp lớp (`training-minutes-v2`, A4 dọc + phụ lục A4 ngang); ZIP có thêm bảng điểm lớp.
- **D — COMPLETE_LOCAL** — Ngày sinh ([ADR 0027](adr/0027-student-date-of-birth.md)): migration `0029`, import cột “Ngày sinh”, hồ sơ/quản trị, bảng điểm lớp `class-sheet-v2`, tự điền trường ngày của biểu mẫu thủ tục; ảnh chụp bản nộp chỉ chứa ngày sinh khi biểu mẫu dùng nó; audit không ghi giá trị.
- **E** — Vai trò lớp trưởng: giữ, làm ở 11.L — **COMPLETE_LOCAL 02/11/2026** theo ADR 0028.

Kiểm chứng: typecheck/lint/format/build đạt; unit API 219 đạt / 2 bỏ qua; integration API 360 đạt; storage/recovery/bundle/guard 315 đạt; web 157 đạt; ca PDF thật đạt; `rehearse:sprint10` PASS với 5 định dạng tải qua trình duyệt; đã xem ảnh render biên bản v2, phụ lục 120 dòng và bảng điểm lớp.

Kiểm chứng D (02/11/2026): typecheck/lint/format/build đạt; ADR gate 52 đạt; unit API 224 đạt / 2 bỏ qua; integration API 362 đạt (thêm ca import ngày sinh + audit không lộ giá trị, ca tối thiểu hóa ảnh chụp bản nộp); storage/recovery/bundle/guard 315 đạt; web 159 đạt; diễn tập migration 0029 trên DB giả giữ dữ liệu cũ (kể cả niên khóa), CHECK từ chối ngày ngoài khoảng.
