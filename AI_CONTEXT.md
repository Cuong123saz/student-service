# Student Service Portal — Bối cảnh và lộ trình cho AI

Cập nhật bối cảnh ngày **02/11/2026**, sau khi đóng Sprint 10 (LOCAL_TECHNICAL) và hồ sơ sprint trong repo. Đây là điểm bắt đầu để AI tiếp tục dự án khi không có lịch sử chat hoặc tệp Word local. Đọc tình trạng thực tế bằng Git và code trước khi sửa; ngày cập nhật tài liệu không có nghĩa kiểm thử đã được chạy lại trong ngày đó.

**Điểm tiếp tục: Sprint 10 đã CLOSED LOCAL_TECHNICAL ngày 02/11/2026 ([hồ sơ đóng](docs/sprint-10-closure.md)); Sprint 11 đã có [kế hoạch đề xuất](docs/sprint-11-plan.md) và [ADR 0025 — niên khóa sinh viên](docs/adr/0025-student-cohort.md), cả hai đã được duyệt ngày 02/11; 11.0 (niên khóa) và nhóm việc theo mẫu Học viện A–C ([ADR 0026](docs/adr/0026-academy-criteria-classification-templates.md): bộ tiêu chí thật, xếp loại tạm tính, bảng điểm lớp, biên bản họp lớp) đã COMPLETE_LOCAL; D — ngày sinh ([ADR 0027](docs/adr/0027-student-date-of-birth.md), dữ liệu cá nhân, tự điền biểu mẫu thủ tục) cũng đã COMPLETE_LOCAL; 11.L — lớp trưởng ([ADR 0028](docs/adr/0028-class-monitor-role.md), migration 0030: xác nhận/bỏ qua, danh sách lớp, in phiếu sau khi khoa duyệt, nhật ký cho cố vấn) đã COMPLETE_LOCAL; 11.1 — CLB và vai trò ([ADR 0029](docs/adr/0029-clubs-and-activity-roles.md), migration 0031) và 11.2 — hoạt động ([ADR 0030](docs/adr/0030-extracurricular-activities.md), migration 0032) và 11.3 — đăng ký, danh sách chờ, hủy ([ADR 0031](docs/adr/0031-activity-registration-waitlist.md), migration 0033) và 11.4 — điểm danh, chứng nhận ([ADR 0032](docs/adr/0032-activity-attendance-certificates.md), migration 0034) đã COMPLETE_LOCAL; tiếp theo là 11.5 — gợi ý điểm rèn luyện ([trạng thái](docs/sprint-11-status.json)).** Production vẫn NOT_READY.

## 1. Dự án và cách cộng tác

Dự án Cổng Dịch vụ Sinh viên của Học viện Quản lý Giáo dục, gồm danh mục dịch vụ, thủ tục/hồ sơ, điểm rèn luyện, hoạt động ngoại khóa và nghiên cứu khoa học. Mục tiêu là một portal thống nhất cho sinh viên và cán bộ, với quyền và phạm vi dữ liệu rõ ràng.

Chủ dự án muốn được phản biện như intern được senior hướng dẫn: chỉ ra giả định sai, lỗi và hệ quả bằng bằng chứng; giải thích quyết định quan trọng, tránh khen chung chung. Trả lời bằng tiếng Việt. Phân biệt yêu cầu hướng dẫn với yêu cầu thực hiện; tiếp tục phần đã được người dùng cho phép, không hỏi lại cùng một xác nhận.

Repo: [Cuong123saz/student-service](https://github.com/Cuong123saz/student-service). Tại lúc cập nhật: 10.3 và 10.4 đã merge vào `main` ([PR 2](https://github.com/Cuong123saz/student-service/pull/2), [PR 3](https://github.com/Cuong123saz/student-service/pull/3)); 10.5 ở nhánh `feat/sprint-10-5-rehearsal-closure`. Tên nhánh và trạng thái dirty phải đọc lại từ Git, không coi các giá trị trong tài liệu là thông tin live. Đường dẫn máy hiện tại là `D:\student-service`; trên máy khác dùng root checkout thực tế, không hard-code đường dẫn này trong sản phẩm.

## 2. Thứ tự đọc và nguồn đối chiếu

1. [AGENTS.md](AGENTS.md): cách làm việc trong repo; [README.md](README.md): khởi động và mô tả chức năng.
2. Tài liệu này: bối cảnh, toàn bộ roadmap và điểm tiếp tục.
3. [Hồ sơ đóng Sprint 10](docs/sprint-10-closure.md), [trạng thái Sprint 10](docs/sprint-10-status.json), [runbook diễn tập](docs/sprint-10-runbook.md).
4. [Quy ước phát triển](docs/development-guidelines.md), ADR và code của phần đang sửa.

Khi có mâu thuẫn, làm rõ nguồn và thời điểm: yêu cầu mới nhất của chủ dự án; code/Git thực tế; ADR và hồ sơ sprint hiện hành; sau đó mới tới tài liệu lịch sử. Code chứng minh chức năng tồn tại nhưng không tự chứng minh chức năng đã qua nghiệm thu. Kế hoạch tương lai không phải kết quả đã triển khai. Không tự đổi trạng thái để làm tài liệu có vẻ thống nhất khi chưa đủ bằng chứng.

Các nguồn dễ bị đọc nhầm:

- `docs/implementation-progress.md` là nhật ký từ 14/10, có mục “bước tiếp theo” đã cũ; dùng để truy vết phần tài liệu/vault/recovery, không lấy đó làm sprint hiện hành.
- `docs/ke-hoach-proj-hop-nhat.docx` là roadmap nguồn, ngày chốt 26/08/2026. Mục trạng thái bên trong còn ở Sprint 2. Tệp hiện được giữ local, chưa theo dõi bằng Git; clone GitHub có thể không có nó. Bảng ở mục 4 dưới đây chép lại mục tiêu 13 sprint thành Markdown và cập nhật trạng thái từ hồ sơ mới hơn. Không ghi đè hoặc tự đưa tệp Word này vào commit.
- `workingTreeHasUncommittedChanges`, `testedImplementationCommit`, `runtimeFiles` và các hash trong hồ sơ kiểm chứng là thông tin tại lượt thu bằng chứng. Ví dụ status Sprint 10 còn chứa fingerprint của increment 10.1; không đem áp nguyên xi lên toàn bộ code 10.2. Đọc scope, thời điểm và chỉ mục bằng chứng tương ứng.
- Địa chỉ demo cũ hoặc báo cáo PASS không chứng minh server/container đang chạy. `run/` và các đường dẫn bằng chứng ngoài repo có thể không tồn tại trên máy khác; thiếu bằng chứng thì ghi rõ chưa xác minh lại, không bịa kết quả.

## 3. Kiến trúc và bản đồ code

Monorepo TypeScript, **modular monolith**, một Fastify API dùng chung PostgreSQL; chưa tách microservice. Web dùng Nuxt 4/Vue 3. Drizzle quản lý schema/migration; một số nghiệp vụ dùng SQL trực tiếp qua postgres-js. Node pin tại `.nvmrc` hiện là **22.23.2**; PostgreSQL test dùng **17**.

| Vị trí | Vai trò và khi cần đọc |
| --- | --- |
| `apps/api/src/app.ts` | Nối dependency và đăng ký route; khởi tạo repository, storage và service tại đây |
| `apps/api/src/modules/auth`, `users`, `organizations` | Identity, account activation, RBAC/scope, hồ sơ, khoa/lớp/cố vấn và import/export sinh viên |
| `apps/api/src/modules/procedures` | Cấu hình thủ tục/biểu mẫu, phiên bản, yêu cầu minh chứng và nơi xử lý |
| `apps/api/src/modules/submissions` | Nháp/nộp/xét duyệt/bổ sung, tài liệu, gói tải, vault/registry và giám sát converter |
| `apps/api/src/modules/signatures` | Chữ ký mô phỏng; không suy ra có chứng thư thật từ tên module |
| `apps/api/src/modules/training-points` | Đợt, tiêu chí A–E, kê khai, minh chứng và snapshot bản nộp |
| `apps/api/src/modules/training-reviews` | Vòng cố vấn/khoa, tổng hợp lớp và các tệp `training-export.*` của Sprint 10 |
| `apps/api/src/modules/audit`, `notifications`, `services` | Audit, thông báo cá nhân và danh mục dịch vụ |
| `apps/api/src/lib/verified-evidence.ts` | Đọc/đối chiếu hash và dung lượng minh chứng qua dependency được truyền vào |
| `apps/api/drizzle`, `apps/api/src/db` | Migration, journal, schema và kết nối DB |
| `apps/web/app/pages`, `components`, `composables`, `types` | Route UI, thành phần, gọi API và hợp đồng TypeScript phía web |
| `apps/api/scripts`, `scripts`, `apps/web/test` | Test runner, discovery, rehearsal dữ liệu giả, ADR gate và web acceptance |
| `docs/adr` | Quyết định kiến trúc; đọc ADR liên quan trước thay hợp đồng/schema |

Route lo HTTP/session/Origin/validation. Service điều phối nghiệp vụ và I/O. Repository lo SQL, quyền hiện tại, khóa và transaction. Service nhận dependency qua constructor; không tự mở database/storage/config toàn cục. Tránh tạo tầng/interface rỗng khi chưa có nhu cầu; theo mẫu DI hiện có và lint gate của repo.

## 4. Roadmap tổng thể 13 sprint

Mục tiêu lấy từ roadmap hợp nhất; trạng thái đối chiếu README và hồ sơ đóng hiện có. Roadmap không ấn định lịch ngày hoặc cam kết thời lượng cho các sprint còn lại.

| Sprint | Mục tiêu và đầu ra | Trạng thái tại lần cập nhật này |
| --- | --- | --- |
| 1 | Danh mục/chi tiết dịch vụ, lọc trạng thái, API test và Nuxt UI | Chức năng đã có theo README; không tự tạo hồ sơ nghiệm thu riêng |
| 2 | Identity, login/logout/me, hồ sơ, khoa/lớp, xác định cố vấn, 401/403 | Đóng cùng Sprint 3 trong `docs/sprint-status.json` |
| 3 | Quản trị user/role/scope, import/export Excel, lời mời và audit | CLOSED ngày 13/09; chủ dự án tự xác nhận, không phải nghiệm thu độc lập |
| 4 | Cấu hình thủ tục, form động, minh chứng, nơi xử lý và version | CLOSED LOCAL_TECHNICAL ngày 14/10 |
| 5 | Sinh viên tự điền, lưu nháp, upload và xem trước | CLOSED LOCAL_TECHNICAL ngày 14/10 |
| 6 | Xét duyệt, yêu cầu bổ sung, quyết định nội dung, DOCX/PDF và bundle | CLOSED LOCAL_TECHNICAL ngày 14/10; đọc giới hạn runtime/recovery trong hồ sơ |
| 7 | Digital signature MVP: mock signer, hash, workflow, verify và audit | CLOSED LOCAL_TECHNICAL ngày 14/10; chữ ký vẫn mô phỏng/NOT_VERIFIED |
| 8 | Đợt, tiêu chí A–E, kê khai/minh chứng, snapshot và lịch sử | CLOSED LOCAL_TECHNICAL ngày 15/10 |
| 9 | Cố vấn xác nhận, khoa trả về/duyệt, lịch sử vòng xét duyệt và tổng hợp lớp | CLOSED LOCAL_TECHNICAL ngày 23/10 |
| 10 | Excel tổng hợp, biên bản Word/PDF, ZIP | CLOSED LOCAL_TECHNICAL ngày 02/11 |
| 11 | Hoạt động ngoại khóa, CLB, đăng ký/danh sách chờ, điểm danh QR + ảnh, chứng nhận tham gia, gợi ý điểm | PLANNED; [plan](docs/sprint-11-plan.md) chờ duyệt, chưa có code |
| 12 | Nghiên cứu khoa học: đề tài, nhóm, giảng viên hướng dẫn, xét duyệt | PLANNED theo roadmap; chưa có module nghiệp vụ tương ứng trong cây modules hiện tại |
| 13 | Hardening/UAT: bảo mật, backup, hiệu năng, accessibility, nghiệm thu local | PLANNED; chưa được coi đã hoàn tất nhờ có test hoặc demo của sprint trước |

Milestone theo roadmap: sau Sprint 3 có nền tài khoản/quản trị; sau Sprint 7 có MVP thủ tục điện tử; sau Sprint 10 có MVP học vụ/điểm rèn luyện; sau Sprint 12 có các chức năng chính của portal. Đây là các mốc phạm vi, không tự đồng nghĩa đã deploy hoặc nghiệm thu vận hành.

Hồ sơ đóng và trạng thái: `docs/sprint-status.json` cho 2+3; từ 4 đến 9 có `docs/sprint-N-status.json` và `docs/sprint-N-closure.md`. Không đóng lại các sprint cũ bằng cách chạy một lệnh test mới rồi ghi đè bằng chứng trước đó.

## 5. Sprint 10 đã có gì

| Increment | Đã có hoặc phải làm tiếp |
| --- | --- |
| 10.1 — COMPLETE_LOCAL | ADR 0021; DTO export snapshot; REPEATABLE READ READ ONLY; đúng scope; kiểm quyền lại ở transaction mới |
| 10.2 — COMPLETE_LOCAL | ADR 0022; bộ sinh XLSX, API tải POST, audit sau render và kiểm chứng tệp thật |
| 10.3 — COMPLETE_LOCAL | ADR 0023; biên bản `training-minutes-v1` DOCX/PDF, PDF từ đúng DOCX, audit sau render, rà PDF thật nhiều trang ([chi tiết](docs/sprint-10-minutes.md)) |
| 10.4 — COMPLETE_LOCAL | ADR 0024; ZIP một snapshot + manifest, CORS expose header, panel tải trên `/training-reviews` ([chi tiết](docs/sprint-10-export-ui.md)) |
| 10.5 — COMPLETE_LOCAL | `rehearse:sprint10` PASS, ca khách ngắt kết nối, [runbook](docs/sprint-10-runbook.md), [hồ sơ đóng](docs/sprint-10-closure.md) |

### Hợp đồng Excel hiện có cần giữ

- `POST /api/v1/user/training-reviews/periods/:id/export.xlsx`, body JSON `{}`. Cookie session user và Origin hợp lệ; từ chối query hoặc body thừa. GET không tạo tệp. Chưa có nút tải trên UI và chưa mở endpoint này ở cổng admin.
- Hai sheet `Thông tin` và `Kết quả đã duyệt`: điểm/đếm là số, mã sinh viên là text giữ số 0 đầu, thời điểm Excel hiển thị UTC+7. Chuỗi giống công thức là literal, không tạo formula/hyperlink/macro. Đây là snapshot giá trị.
- Chỉ xuất bản APPROVED. Điểm lấy từ quyết định khoa cuối và cố vấn parent tương ứng, giữ riêng điểm tự khai. Ví dụ đã diễn tập: tự khai 15, khoa duyệt 14. Bản chưa duyệt không được biến thành hàng điểm 0; điểm được duyệt bằng 0 vẫn là dữ liệu hợp lệ.
- Giới hạn 1.000 bản duyệt, 8 MiB tệp, hai tác vụ/service instance, một tác vụ/tài khoản, rate limit 5 yêu cầu/phút/IP. Không cắt âm thầm.
- Sau render: kiểm lại quyền và ghi `training.export.xlsx.prepared` trong cùng transaction ngắn có khóa SHARE. Lỗi quyền/audit chặn trả byte. Audit SUCCESS chứng minh tệp được chuẩn bị/cho phép trả, không chứng minh trình duyệt đã nhận đủ.
- `private, no-store` kể cả lỗi; phản hồi thành công có `X-Export-Snapshot-Id` và `X-Export-Sha256`. Từ 10.4 các header `X-Export-*` được expose qua CORS và UI đối chiếu SHA-256 trước khi lưu tệp (ADR 0024).

Chi tiết tại [hướng dẫn Excel](docs/sprint-10-xlsx.md), [ADR 0021](docs/adr/0021-training-point-export-snapshot.md), [ADR 0022](docs/adr/0022-training-point-xlsx-download.md). Tên lớp/sinh viên/actor đã chốt phải giữ theo snapshot; metadata lớp/khoa hiện tại và tên tại lúc nộp là hai nguồn có thời điểm khác nhau.

### Hợp đồng biên bản hiện có cần giữ (10.3)

- `POST .../periods/:id/minutes.docx` và `.../minutes.pdf`, body `{}`, cùng quyền/Origin/validation/rate limit với Excel. Audit `training.export.docx.prepared`/`training.export.pdf.prepared` có `templateVersion`; PDF có `sourceDocxSha256`. Metadata XLSX giữ năm khóa cũ.
- Mẫu sinh bằng code (`training-export.docx.ts`), phiên bản `training-minutes-v1` được ghim bằng hash nội dung trong unit test. Đổi bố cục thì tăng version cùng pin, không sửa âm thầm.
- PDF luôn chuyển từ đúng buffer DOCX trong cùng request qua `LibreOfficePdfConverter`. Lỗi converter trả 503 `TRAINING_EXPORT_PDF_*`, không audit. Không render hay chạy converter khi giữ khóa DB.
- Excel/Word dùng chung `assertTrainingExportSnapshot`. Microsoft Word desktop chưa kiểm; CI không có LibreOffice nên ca PDF thật là opt-in `TRAINING_MINUTES_REAL_PDF=true`.

### Bắt đầu Sprint 11 khi người dùng yêu cầu tiếp tục

1. Đọc lại Git và trạng thái PR của 10.5 và plan Sprint 11. Đọc [plan](docs/sprint-11-plan.md): bảng actor, quy tắc đã chốt, mục “chờ xác nhận” và rủi ro đã chấp nhận. Không tự đổi quyết định của chủ dự án; mâu thuẫn thì nêu và hỏi.
2. 11.0 đã xong theo ADR 0025 — **niên khóa K = năm vào học − 2006**, DB lưu năm vào học (giữ nguyên các quyết định sau): cột `cohort_year` nullable trên `student_profiles`, import thêm cột “Niên khóa” (không nhận alias `khoa` vì trùng “Khoa” sau bỏ dấu), audit, thêm ánh xạ vào ADR gate.
3. **Migration mới phải viết tay** và thêm entry journal như 0025–0028; không dùng `drizzle-kit generate` (snapshot chỉ tới 0024, lệnh sẽ sinh lại các bảng Sprint 7–9). Mỗi increment sau (11.1–11.6) lập ADR trước schema/quyền. Chứng nhận tham gia không phải văn bằng/chữ ký số; gợi ý điểm không sửa bản đã nộp hay điểm đã duyệt; “Giấy xác nhận sinh viên” vẫn OFFLINE.

Chạy lại diễn tập Sprint 10 theo runbook khi đổi code xuất; nhớ đặt `WORKFLOW_PLAYWRIGHT_MODULE`/`WORKFLOW_CHROMIUM_EXECUTABLE`.

## 6. Bất biến nghiệp vụ

- Identity dùng chung nhưng session/cookie/audience user và admin tách biệt. Quyền nghiệp vụ phải kiểm tại server, không lấy việc ẩn nút hoặc role trong JWT làm bằng chứng đủ quyền hiện tại.
- Cố vấn cần đúng role, permission trên cùng role, scope và phân công còn hiệu lực. Khoa cần đúng role/permission/scope; SYSTEM_ADMIN không tự thay các vai trò đó. Thu hồi quyền/scope/phân công phải có hiệu lực khi xử lý hoặc tải tiếp.
- Bản nộp và minh chứng giữ nguyên; lịch sử quyết định append-only. Khoa trả về mở vòng cố vấn mới, không mở sửa bản sinh viên. Không tự duyệt hồ sơ của mình hoặc ghép hai vai trò để bỏ qua tách người của cùng vòng.
- Điểm rèn luyện tự khai khác điểm đã duyệt. Tiêu chí A–E hiện là giả định, chưa tự tạo xếp loại chính thức. Không tự cộng điểm từ đăng ký hoạt động ngoại khóa hoặc đề tài NCKH khi chưa chốt quy tắc nghiệp vụ.
- Hash chỉ chứng minh đối chiếu byte, không chứng minh chữ ký số/thẩm quyền/hiệu lực. Mock signing vẫn NOT_VERIFIED, legalEffect=false; minh chứng chữ ký/dấu chưa được xác minh. Không tạo chữ ký/dấu giả cho bản xuất.
- **Giấy xác nhận sinh viên vẫn OFFLINE tại Phòng CTSV.** Không tự bật online để làm demo trông hoàn chỉnh.
- Bảo toàn template v1, tài liệu bất biến và bằng chứng sprint trước. Database, kho tệp và recovery phải đối chiếu cùng phiên bản. Bằng chứng backup trước khi có bảng review không tự bao phủ schema mới.

## 7. Môi trường và cách kiểm tra

Đọc `.nvmrc`, `.npmrc`, package scripts và README trước khi chạy. Dùng Node 22.23.2 theo pin hiện tại; đổi phiên bản là một thay đổi riêng có kiểm chứng. Chỉ tạo `.env` từ file example cho môi trường được phép; không in secret hoặc commit `.env`, token, khóa/chứng thư, dữ liệu thật. `node_modules/`, `dist/`, `run/`, `.local/` là dữ liệu sinh/local, không publish.

| Kiểm tra | Lệnh tại root repo hoặc điều kiện |
| --- | --- |
| Typecheck API/web | `npm run check`; chạy riêng `check:api` hoặc `check:web` nếu phù hợp phạm vi |
| Lint | `npm run lint` hiện chỉ kiểm API; không báo là lint web đã đạt |
| Định dạng | `npm run format:check`; nhận biết phạm vi glob trong package.json, có tệp script/tài liệu phải kiểm riêng |
| Unit API | `npm run test:unit --workspace @student-service/api`; không cần DB, một số ca cần OS/converter |
| Integration API | `npm run test:integration --workspace @student-service/api`; chỉ khi PostgreSQL test riêng và `.env.test` sẵn sàng |
| Web | `npm run test:web`; unit và Nuxt acceptance mỗi project một lần |
| Toàn bộ | `npm test` gồm nhiều nhóm, có yêu cầu DB/converter; không coi lệnh chưa khởi động là PASS |
| Build | `npm run build`; riêng `build:api` hoặc `build:web` theo phần thay đổi |
| ADR gate | `npm run test:sprint4-adr`; xem thêm script gate khi migration liên quan thay đổi |

DB test theo `docker-compose.test.yml`: localhost:5434, database `student_service_test`, PostgreSQL tmpfs. Không thay bằng DB development/production để vượt lỗi kết nối. Test xét duyệt tự tạo/xóa database giả riêng từ control DB này. Không chạy đồng thời các lượt dùng chung container nếu một lượt sẽ dừng nó. Chỉ dọn DB/container/process thuộc lượt mình tạo; bảo toàn nguồn legacy và môi trường đang dùng.

Web acceptance dùng cache Nuxt riêng để không ghi đè manifest bản build. Discovery phân loại test qua import thực; dependency DB/app gián tiếp vẫn cần integration. Không đổi tên/glob để làm test lỗi biến mất. Khi converter/OS không sẵn sàng, báo rõ giới hạn; không dùng unit thay cho kiểm chứng SQL/trigger/HTTP hoặc render thật.

### Bằng chứng gần nhất, không phải test vừa chạy hôm nay

Ngày 02/11 (container Linux, khi đóng Sprint 10): 1.092 đạt / 2 bỏ qua / 0 thất bại trên các nhóm ADR gate, unit, integration, storage/recovery/bundle/guard và web; diễn tập Sprint 10 và Sprint 9 PASS. Chi tiết tại `docs/sprint-10-closure.md`.

Ngày 23/10: baseline toàn dự án ghi 1.065 đạt/1 bỏ qua do symlink Windows. Sau sửa Sprint 9, web 147 bài và diễn tập 14 nhóm/16 responsive đạt. Sprint 10.2 cuối có 9 unit Excel/service và 19 theo runner HTTP/SQL (18 ca con + 1 nhóm), typecheck/lint/build API đạt. Tệp Excel được đọc lại và rà bằng LibreOffice; Microsoft Excel desktop chưa kiểm trực tiếp. Không cộng các lần chạy lại hoặc các con số này thành tổng mới.

Các báo cáo hiện nằm ở `docs/sprint-9-closure.md`, `docs/sprint-10-xlsx.md` và status tương ứng. Chỉ mục bằng chứng byte/ảnh/log được giữ local, nhiều đường dẫn không nằm trong Git. AI trên máy khác phải chạy lại phần cần thiết hoặc xin nguồn bằng chứng nếu cần xác minh, không giả định đã thấy các tệp đó.

## 8. Tiếp tục các sprint sau và cập nhật tài liệu

Sprint 10 đã đóng LOCAL_TECHNICAL. Kế hoạch Sprint 11 chi tiết cần: chốt actor/scope, sức chứa đăng ký, trạng thái và tranh chấp đăng ký/điểm danh, rồi mối liên hệ với minh chứng. Với Sprint 12, chốt vòng đời đề tài, thành viên, giảng viên hướng dẫn và quy trình xét duyệt trước khi thiết kế schema. Các chi tiết này là việc phải làm rõ, chưa phải đặc tả đã được chấp thuận.

Sprint 13 tập trung hardening/UAT, bảo mật, phục hồi, hiệu năng và accessibility theo roadmap. Lỗi mất dữ liệu, sai quyền, thiếu test discovery hoặc chặn tích hợp không nên trì hoãn chỉ vì có sprint hardening riêng. Quy chế, mẫu chính thức, ký thật và triển khai phải theo yêu cầu và phê duyệt tương ứng, không tự suy ra từ kết quả local.

Sau mỗi increment, cập nhật cùng lượt với code: plan/status sprint, hướng dẫn chức năng, README và mục “điểm tiếp tục” trong tài liệu này nếu thay đổi. Ghi ngày, phần đã có, phần đã kiểm chứng, lệnh/phạm vi test, giới hạn còn lại và bước tiếp theo. Giữ dữ liệu lịch sử nguyên nghĩa; không ghi đè kiểm chứng cũ bằng một lần chạy mới khác scope.

Trước khi kết thúc, báo ngắn: đã thay đổi gì, vì sao, kiểm tra nào thật sự chạy và kết quả, phần nào chưa làm, commit/push hay chưa. Khi người dùng yêu cầu push, xem diff và remote/nhánh, rà dữ liệu không nên publish, commit phạm vi được phép rồi xác minh đồng bộ; không force-push hoặc đưa tệp Word local vào Git theo suy đoán.
