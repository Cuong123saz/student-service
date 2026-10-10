# Đối chiếu kho minh chứng trước khi chuẩn bị sao lưu

Ngày kiểm chứng: 10/10/2026. Increment local; không thay đổi schema, API hoặc nghiệp vụ giấy xác nhận sinh viên OFFLINE tại CTSV.

## Công cụ đã làm được

`audit:storage` là lệnh vận hành chỉ đọc, đối chiếu metadata trong PostgreSQL với byte gốc trong `SUBMISSION_STORAGE_ROOT`:

- Đọc mọi `submission_files`, bao gồm bản ghi đã gỡ mềm; không chỉ lấy tệp của bản nháp đang hiển thị.
- Đọc tham chiếu trong mọi `submission_rounds.files`; kiểm tra fileId, hồ sơ sở hữu, khóa kho, dung lượng và SHA-256 khớp metadata gốc. Tham chiếu lịch sử thiếu metadata vẫn được kiểm tra byte nếu thông tin hợp lệ.
- Kiểm tra tệp thiếu, sai dung lượng, sai SHA-256, metadata sai/conflict và tham chiếu lịch sử sang hồ sơ khác.
- Báo tệp chưa có liên kết, tên ngoài quy ước, directory/link/junction bất thường. Không đọc đệ quy hoặc theo link; không tự xóa, chuyển, sửa hay tạo tệp trong kho.
- Hash tuần tự qua stream, chặn đọc vượt dung lượng đã khai báo tối đa 5 MiB/tệp; kiểm tra file stat trước/sau khi đọc và thay đổi thư mục trong thời gian quét.
- Chỉ lấy trường phục vụ đối chiếu; không lấy câu trả lời, hồ sơ học vụ, tên gốc hoặc ghi chú xét. Báo cáo dùng fileId/roundId và SHA-256 của khóa kho, không xuất khóa kho hay đường dẫn, thông tin kết nối, byte gốc hoặc lỗi SQL nội bộ.

Đọc database trong transaction `REPEATABLE READ READ ONLY`, một kết nối, mỗi lô 256 dòng và timeout từng câu SQL 30 giây. Giữ metadata/tham chiếu trong bộ nhớ để đối chiếu; đây là công cụ local, chưa kiểm chứng bộ nhớ/thời gian cho kho lớn. Báo cáo đếm đầy đủ lỗi, chỉ giữ tối đa 100 chi tiết; `detailsTruncated` cho biết có bỏ bớt chi tiết hay không.

## Chạy trên development

Xác định đúng thư mục mà API đang dùng trước khi chạy. Mặc định của API là `.local/submission-files` **tính từ thư mục chạy API**, thường là `apps/api`; không lấy mặc định này theo thư mục mở terminal. Công cụ bắt buộc đường dẫn tuyệt đối và không tự tạo thư mục khi thiếu.

Từ thư mục repository:

```powershell
$env:SUBMISSION_STORAGE_ROOT = 'D:\student-service\apps\api\.local\submission-files'
npm run audit:storage --workspace @student-service/api
Remove-Item Env:SUBMISSION_STORAGE_ROOT
```

Lệnh npm nạp `apps/api/.env`. Chỉ chấp nhận `APP_ENV=development` + `localhost`/`127.0.0.1:5433/student_service`, hoặc `APP_ENV=test` + `localhost`/`127.0.0.1:5434/student_service_test`; từ chối môi trường production, máy chủ khác, query options của connection URL và đối số CLI trước khi kết nối. Không truyền mật khẩu trong câu lệnh.

Nếu muốn lưu JSON thuần vào thư mục `run` đã được Git bỏ qua, chạy trực tiếp từ repository:

```powershell
$env:SUBMISSION_STORAGE_ROOT = 'D:\student-service\apps\api\.local\submission-files'
node --env-file=apps/api/.env apps/api/scripts/audit-evidence.mjs > run/evidence-audit.json
$taskAuditExit = $LASTEXITCODE
Remove-Item Env:SUBMISSION_STORAGE_ROOT
```

Dùng cấu hình đúng của máy đang chạy; ví dụ trên không tự thay đổi cấu hình API. Không gửi kho minh chứng, database dump, `.env` hoặc báo cáo vận hành lên Git. Báo cáo dù đã giảm dữ liệu vẫn có định danh nội bộ, cần giữ riêng.

| Exit code | Trạng thái | Diễn giải                                                                                                    |
| --------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| 0         | OK         | Lượt quét hoàn tất, không phát hiện vấn đề trong phạm vi kiểm tra; kho rỗng cũng có thể trả 0.               |
| 2         | ATTENTION  | Có phát hiện cần đối chiếu; xem `issuesByCode`, `issueCount` và chi tiết đã giới hạn.                        |
| 1         | INCOMPLETE | Không hoàn tất do cấu hình, thư mục thiếu/không an toàn, database/quyền đọc/I/O lỗi; không đánh giá kho đạt. |

`UNREFERENCED_FILE` chỉ có nghĩa lượt quét không thấy metadata tham chiếu. Có thể là upload đang chạy hoặc lần lưu mất phản hồi; không dùng kết quả này để xóa tự động. `HISTORY_METADATA_MISMATCH` cần giữ cả byte gốc và dữ liệu lịch sử để điều tra. Với tệp thiếu/hash sai, bảo toàn bản hiện tại và đối chiếu bản sao tin cậy; không cập nhật hash để che lỗi.

## Phạm vi bảo đảm

Báo cáo luôn ghi `mode=OBSERVATIONAL_READ_ONLY`, `consistentBackup=false`, `signaturesChecked=false`, `malwareScanned=false`.

Snapshot database không khóa ổ đĩa cùng thời điểm. Upload/lưu hồ sơ đồng thời có thể tạo kết quả cần kiểm tra lại; các kiểm tra stat chỉ phát hiện một số thay đổi, không bảo đảm chống mọi trường hợp đổi tệp hoặc một người có quyền sửa ổ đĩa. Chạy trên kho tin cậy; khi đối chiếu trước sao lưu cần dừng các thao tác ghi và chờ tác vụ đang chạy hoàn tất.

Một lượt OK không chứng minh đã sao lưu/khôi phục được, không chứng minh tài liệu có hiệu lực, không kiểm tra chữ ký mật mã/chứng thư và không thay cho quét mã độc. SHA-256 chỉ đối chiếu byte với metadata đang có.

## Kiểm chứng increment này

- 21 kiểm thử tệp/cấu hình: tệp đang dùng và gỡ mềm, lặp tham chiếu lịch sử, thiếu tệp, sửa byte cùng kích thước, sai dung lượng, không xóa tệp chưa liên kết, không lộ khóa/tên riêng, thiếu/sai metadata lịch sử, đường dẫn vượt kho, giới hạn chi tiết, root thiếu/sai/link, junction giả khóa, quét bị ngắt và kho đổi trong lúc quét.
- 1 kiểm thử SQL trên database test: bảng tạm riêng theo schema đã migrate, đọc metadata đã gỡ, JSON lịch sử đúng/sai cấu trúc, loại bỏ trường riêng tư, đọc 301 metadata qua nhiều lô; truy vấn public chạy trong transaction chỉ đọc. Không reset hoặc sửa bảng dữ liệu thật.
- Typecheck, lint, build API, định dạng các file mới và kiểm tra diff: đạt. Không đổi giao diện hoặc logic API, nên không chạy lại toàn bộ hồi quy ứng dụng trong increment này.
- Smoke CLI với database test rỗng và kho giả: exit 0 khi rỗng, exit 2 khi có tệp chưa liên kết, exit 1 khi root thiếu; metadata database không đổi. Đây là kiểm thử thêm, không cộng vào 22 test tự động.
- Development hiện có **0 metadata tệp, 0 lần gửi lịch sử**; thư mục mặc định `apps/api/.local/submission-files` chưa tồn tại. Công cụ trả **INCOMPLETE**, không tự tạo kho để biến kết quả thành OK. Đây chưa phải kiểm chứng trên hồ sơ thật.

Chạy lại:

```powershell
npm run test:storage --workspace @student-service/api
```

Lệnh này nằm trong `npm run test` của API, nên workflow CI hiện có cũng chạy nó sau các test ứng dụng. Bằng chứng local được Git bỏ qua: `run/evidence-storage-tests.log`, `run/evidence-cli-smoke.log`, `run/evidence-development-audit-error.json`.

## Bước vận hành tiếp theo

Xây dựng và diễn tập sao lưu **cả database và kho tệp riêng**, gồm cả byte đã gỡ hoặc chỉ còn trong lịch sử. Cần chốt cách ngừng mọi nguồn ghi trong thời gian chụp, lưu bản sao ở nơi riêng có kiểm soát truy cập, và khôi phục vào môi trường trống tách biệt. Chỉ đánh giá phục hồi đạt sau khi đối chiếu lại byte/metadata và thử quyền truy cập hồ sơ/tệp; không phục hồi đè development để thử. Git hiện chỉ giữ mã nguồn.

Backup/restore, retention, kho bền vững và quét mã độc theo [ADR0003](adr/0003-student-drafts-and-evidence.md) vẫn là điều kiện vận hành chưa hoàn thành. Không tự đóng Sprint4/5 hoặc mở production từ kết quả increment này.


## Diễn tập phục hồi đã bổ sung

Ngày 10/10/2026, [diễn tập phục hồi bằng dữ liệu giả](recovery-rehearsal.md) đã hoàn thành: dừng writer, sao lưu, xóa database nguồn giả, phục hồi vào PostgreSQL mới, đối chiếu dữ liệu/tệp và thử quyền qua API. Phạm vi này chưa thay cho backup vận hành dữ liệu thật, retention, kho bền vững hoặc quét mã độc.
