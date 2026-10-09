# Kế hoạch triển khai Sprint 4

Ngày chuẩn bị: 09/10/2026. Trạng thái: IN_PROGRESS. Chủ dự án yêu cầu triển khai cấu hình ngày 09/10/2026. Sprint 2+3 đã có artefact CLOSED; [ADR 0001](adr/0001-submission-workflow.md) đã Accepted theo yêu cầu triển khai và xác nhận quy trình CTSV trong hội thoại.

Sprint 4 tạo được cấu hình thủ tục có phiên bản: admin tạo nháp, khai báo field/minh chứng/workflow, validate và publish; sinh viên xem được bản publish. Nộp hồ sơ, upload thật và resolve cố vấn thuộc Sprint 5. Review task và DOCX/PDF thuộc Sprint 6; ký thuộc Sprint 7.

## Baseline và phần việc đã chuẩn bị

Baseline đọc tại `db62d7e81ba5bbf5fb11a8dc5a9f6bda007512e6`, nhánh `fix/admin-session-expired-modal`. Những thay đổi chuẩn bị này chưa được commit.

| Hạng mục                     | Trạng thái                  | Bằng chứng                                                                                                |
| ---------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| Đóng Sprint 2+3              | Có artefact lịch sử         | [sprint-status.json](sprint-status.json), tự xác nhận của chủ dự án                                       |
| Đối chiếu kiến trúc và quyền | Đã đọc source               | services, role-permission, scope, organization, audit                                                     |
| ADR version/form/workflow    | Đã soạn; chờ duyệt          | [ADR 0001](adr/0001-submission-workflow.md)                                                               |
| Pilot                        | Đề xuất, chưa xác nhận      | STUDENT_CONFIRMATION, owner CTSV, OFFLINE: sinh viên làm việc trực tiếp tại Phòng CTSV                                                       |
| Cổng migration               | Đã bổ sung phạm vi cấu hình | procedure_versions, procedure_form_configs, attachment_requirements, workflow_definitions, workflow_steps |
| Kiểm thử cổng ADR            | Có bộ kiểm thử tự động      | `npm run test:sprint4-adr`; 19/19 đạt ngày 09/10/2026 trên Node 22.23.2                                   |
| Migration/API/UI Sprint 4    | Chưa triển khai             | Không ghi trạng thái Done khi mới có thiết kế                                                             |

Roadmap Word hiện còn ghi trạng thái Sprint 2 cũ và nằm ở file chưa được Git theo dõi. Cần đồng bộ tài liệu này sau khi chốt ADR; không sửa hoặc ghi đè bản người dùng đang chỉnh.

## Cổng đầu vào

1. Chủ dự án duyệt ADR và xác nhận pilot/fields/đơn vị xử lý.
2. ADR Accepted được commit/merge vào base trước PR migration.
3. Chọn nhánh tính năng từ baseline đã tích hợp; xác minh thay đổi phiên hết hạn và quality gate đã nằm trong base mong muốn.
4. Dùng Node 22.23.2 theo .nvmrc; terminal vừa kiểm tra đang dùng 22.18.0, thấp hơn engine tối thiểu 22.19.0. Chạy lệnh với runtime đúng trước khi kiểm định ứng dụng.
5. Ghi ngày bắt đầu thực tế và năng lực thực hiện rồi mới ấn định sprint hai tuần; không tái sử dụng lịch cũ.

## Backlog theo thứ tự phụ thuộc

| Story | Deliverable                      | Điều kiện nghiệm thu chính                                                                                                           |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| S4-01 | Duyệt ADR và pilot               | Fields, attachment, actor, scope, bất biến và lỗi/concurrency được chốt; Accepted tồn tại trong base                                 |
| S4-02 | Schema và migration aggregate    | FK, unique version, một DRAFT/PUBLISHED mỗi service, order/key unique, migration trên PostgreSQL test sạch                           |
| S4-03 | Policy và API bản nháp           | 401/403; scope thuộc cùng role; create/clone/update/read; expectedRevision; audit transaction                                        |
| S4-04 | Validator biểu mẫu và minh chứng | Allowlist type/source; duplicate key/options; size/count; báo lỗi theo đường dẫn                                                     |
| S4-05 | Validator workflow và publish    | Tuyến tính, actor hợp lệ, revision/state lock; publish/retire/audit atomic; config đã publish không sửa được                         |
| S4-06 | API đọc published config         | Sinh viên ACTIVE chỉ đọc dịch vụ ACTIVE có bản PUBLISHED; không lộ draft/actor/audit                                                 |
| S4-07 | UI admin cấu hình và preview     | Loading/empty/error; lỗi theo field/step; thiếu quyền/phiên hết hạn; giữ dữ liệu khi conflict để người dùng xử lý                    |
| S4-08 | Demo và regression               | Tạo v1 → preview → publish → clone v2 → publish → đọc lại v1 bất biến; kiểm tra 403 và race; tài liệu/bằng chứng/chấp nhận increment |

Không bắt đầu nhiều module song song khi S4-02/S4-03 chưa đạt; phải có một lát cắt API/policy/database có thể kiểm chứng trước khi mở rộng UI.

## Kiểm thử quyết định nghiệm thu

- Config sai field key, PROFILE source, type, option trùng hoặc giới hạn phải bị từ chối.
- Không cho publish workflow thiếu REVIEW, sai order, action/rule chưa hỗ trợ hoặc tham chiếu không hợp lệ.
- Permission ở role A và scope ở role B không được gộp thành quyền cấu hình.
- ORGANIZATION đúng owner được cấu hình; đơn vị khác và FACULTY/CLASS bị từ chối.
- Sửa parent/child đã publish hoặc retired đều bị từ chối; clone tạo ID mới và giữ nội dung cũ.
- Hai update cùng revision: một thành công, một 409; không lost update.
- Hai publish cùng revision: một thành công, một 409; đúng một PUBLISHED và một audit publish.
- Update field và publish đồng thời: kết quả tuần tự hợp lệ; không publish aggregate bị sửa xen kẽ.
- Audit insert lỗi: rollback cả publish và retire phiên bản trước.
- Sinh viên không đọc draft hoặc config của dịch vụ INACTIVE.
- Published config cũ đọc theo version ID vẫn giữ nguyên khi v2 có hiệu lực.
- Kiểm thử giao diện có mock phải được ghi rõ; demo trình duyệt đi qua Web → API → PostgreSQL là bằng chứng khác.

## Definition of Done

Story chỉ Done khi acceptance criteria đạt, typecheck/lint/format đạt, test liên quan đạt, API/Web build đạt khi có thay đổi ứng dụng, migration test đạt nếu có schema, request/response validation đầy đủ, scope được kiểm thử, audit phù hợp và UI xử lý loading/error/empty.

Sprint chỉ được đóng sau demo local và chủ dự án chấp nhận increment. Chưa triển khai production, ký thật, engine workflow có nhánh hoặc nộp hồ sơ trong Sprint 4.

## Các quyết định cần chủ dự án xác nhận

Đề xuất cụ thể là STUDENT_CONFIRMATION do CTSV sở hữu cấu hình; fields purpose/recipient; không yêu cầu minh chứng; REVIEW dùng STUDENT_ADVISOR trong demo local. Chủ dự án có thể chấp nhận gói này hoặc sửa tên thủ tục, fields, đơn vị và actor.

Nếu muốn nhân viên CTSV xét duyệt thay cố vấn, phải chốt role/rule và phạm vi đọc hồ sơ; ORGANIZATION hiện không tự cho quyền đọc dữ liệu sinh viên. Không đưa thiết kế đó vào migration trước khi sửa và duyệt ADR.

Sau xác nhận mới cập nhật ADR Accepted và lên kế hoạch triển khai S4-02. Hiện chưa có chữ ký mới hoặc lịch bắt đầu Sprint 4.

## Bằng chứng kiểm tra thay đổi chuẩn bị

Ngày 09/10/2026, chạy bằng Node 22.23.2:

- Trước bản sửa, ca migration tạo procedure_versions khi chưa có ADR thất bại đúng như dự kiến: cổng cũ cho qua với thông báo không phát hiện migration liên quan.
- Sau bản sửa, bộ kiểm thử cổng đạt 19/19. Bao phủ năm bảng cấu hình Sprint 4 và ba bảng được bảo vệ từ trước, ADR thiếu/Proposed, duyệt ADR trong cùng thay đổi migration, trạng thái đóng sprint thiếu/sai, sửa migration cũ và revision không tồn tại.
- Bộ kiểm thử tạo Git repository tạm riêng; không migrate hoặc reset database development.
- Các file mới và script sửa được định dạng theo Prettier của dự án. Root npm test chạy thêm bộ kiểm thử này, nên bước npm test trong CI hiện có sẽ kiểm tra cổng.
- Không chạy lại full regression API/Web cho thay đổi chuẩn bị này vì không sửa ứng dụng hoặc schema. Số liệu Sprint 3 trong hồ sơ lịch sử không phải kết quả chạy lại ngày 09/10.

## Điều chỉnh nghiệp vụ ngày 09/10/2026
Chủ dự án xác nhận giấy xác nhận sinh viên được xử lý trực tiếp tại Phòng CTSV. Triển khai cấu hình hình thức thực hiện, đơn vị xử lý và biểu mẫu theo dịch vụ; bỏ giả định bắt buộc cố vấn xét duyệt. ADR hiện tại thay phần thiết kế Proposed trước đó, gồm một aggregate JSON có schema trong procedure_versions thay cho năm bảng con ở MVP. Fields và minh chứng là cấu hình do admin quyết định. Các dòng backlog phía trên là kế hoạch lịch sử; kết quả thực hiện sẽ được ghi sau kiểm thử.
