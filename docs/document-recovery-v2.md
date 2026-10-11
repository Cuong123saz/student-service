# Phục hồi mẫu và tài liệu đầu ra — nền tảng B1

Cập nhật 11/10/2026. Đã triển khai B1 của [ADR0010](adr/0010-document-vault-and-recovery.md), tiếp [ADR0009](adr/0009-immutable-generated-documents.md). Chỉ dùng dữ liệu giả. Đây là công cụ và phép thử phục hồi; registry/job đã có schema và repository ở DB test theo [nền tảng B2](document-registry.md), chưa chuyển route tải sang kho cố định, chưa ký hoặc phát hành.

## Cấu trúc và tương thích

Recovery bundle v1 vẫn được đọc/kiểm tra/xuất/giải mã/khôi phục với layout cũ `database.dump`, `files/`, `manifest.json`. Bundle v2 thêm hai thư mục ngang hàng: `templates/` và `documents/`. Không đặt Word/PDF vào kho minh chứng. Version của envelope mã hóa và AES-256-GCM vẫn là 1; nội dung manifest recovery bên trong có thể là 1 hoặc 2 và từng tên entry được ràng buộc bằng AAD như trước.

Manifest v2 luôn ghi `assetMetadataSource: TECHNICAL_FIXTURE`. Validator từ chối tự nhận đã kiểm chứng registry DB. Metadata tài liệu gồm UUID key/bộ/round/hồ sơ, số lần gửi, định dạng, size/SHA-256, binding mẫu, phiên bản renderer/converter và nguồn Word của PDF. Không chứa câu trả lời hoặc path máy. Fixture ghi hash file renderer cùng Node/ICU và phiên bản LibreOffice trả về; chưa coi đó là digest đầy đủ của build hay binary converter như B2 yêu cầu. Chỉ nhận DECLARATION và UNSIGNED_DECLARATION. Word có thể tồn tại khi PDF còn thiếu; nếu có PDF thì phải có Word cùng bộ/round/binding/renderer, hash nguồn trùng Word. Một round không được có hai bộ DECLARATION trong cùng manifest.

| Thành phần | Layout | Giới hạn mỗi tệp |
| --- | --- | --- |
| Minh chứng | `files/<UUID>` | 5 MiB |
| Mẫu | `templates/submission-summary-vN.docx` | 1 MiB |
| Word/PDF đầu ra | `documents/<UUID>` | 16 MiB |
| Manifest recovery | JSON | 2 MiB |
| Payload metadata mã hóa | JSON được mã hóa | 4 MiB |
| Database dump | `database.dump` | 512 MiB |

Tối đa 32 mẫu và 5.000 output trong hợp đồng hiện tại; giới hạn manifest áp dụng thêm nên không cam kết mọi tập 5.000 bản đều chứa vừa. V1 có thuộc tính output/mẫu bị từ chối để không âm thầm bỏ tài liệu khi phục hồi theo layout cũ.

## Đọc, sao chép và phục hồi

Ba root nguồn và các root đích phải tuyệt đối, riêng nhau, không lồng nhau, không qua symlink/junction. Inventory từ chối thiếu/thừa/orphan, entry không đúng tên, directory giả file, size/hash sai hoặc root thay đổi khi quét. Không tự xóa hoặc sửa file bất thường.

Metadata được đọc từ handle với buffer có giới hạn trước cấp phát và byte sentinel phát hiện tăng dung lượng. Sao chép dùng handle nguồn đã đối chiếu lstat/fstat, buffer tối đa 64 KiB và ghi độc quyền. Chỉ ghi đúng kích thước đã kiểm chứng, kiểm tra byte thừa/hash/metadata cuối, fsync file đích. Không để copyFile sao chép một file nguồn đang tăng vô hạn rồi mới kiểm tra dung lượng sau. Không tuyên bố chống mất điện: chưa fsync thư mục và chưa thử power-loss theo nền tảng.

Backup kiểm tra nguồn dừng trước/sau và đối chiếu inventory sau dump; manifest hoàn tất được ghi cuối, từ chối vượt 2 MiB trước khi ghi. Archive thường và mã hóa đều mang đủ ba kho; mỗi byte đã chép/giải mã được đối chiếu trước ghi nhận thành công. Mã hóa xác thực tất cả entry trước tạo plaintext đích. Bản sao lỗi giữ trạng thái không hoàn tất, không ghi đè bản cũ.

Restore xác minh bundle trước, yêu cầu cả ba root đích mới khi version2. Kiểm tra tất cả đích chưa tồn tại trước tạo bất kỳ root nào; không khôi phục một phần chỉ vì thư mục documents đã có. Sau copy kiểm tra lại size/hash/layout. Quét này không tạo snapshot filesystem nguyên tử; freeze writer vẫn là điều kiện bắt buộc.

## Cách thử bằng dữ liệu giả

Từ root repository, cấu hình LibreOffice có sẵn trong PATH hoặc đặt LIBREOFFICE_PATH theo máy. Ví dụ local Windows:

```powershell
$env:LIBREOFFICE_PATH='D:\student-service\run\tools\LibreOffice\program\soffice.com'
npm.cmd run rehearse:document-recovery --workspace @student-service/api
```

Lệnh chạy kiểm thử recovery và build, sau đó tạo PostgreSQL17 tmpfs riêng ở cổng ngẫu nhiên, dữ liệu giả đủ sáu kiểu trường/hai round, render Word/PDF thật, sao lưu và phục hồi vào cluster mới sau khi bỏ cluster nguồn. Mặc định archive ở thư mục tạm. Chọn D và mã hóa qua công cụ recovery hiện có, chỉ thêm cờ `--document-assets`:

```powershell
node apps/api/scripts/rehearse-recovery.mjs --fake-data-only --document-assets --archive-root D:\kho-sao-luu-gia-rieng
```

Thêm `--encryption-key` trỏ đến key thử đã tạo bằng công cụ mã hóa hiện có khi cần. Không lưu key vào Git, trong archive hoặc trong thư mục dự án. Không đưa DATABASE_URL/SUBMISSION_STORAGE_ROOT bên ngoài vào buổi thử. Lệnh từ chối production, không dùng database5433/5434 và không reset demo3011/3013/3015.

Fixture xuất metadata từ chính hai round giả và ghi rõ registryIntegration NOT_IMPLEMENTED. Sau restore, đối chiếu round ID, submission ID, round number và binding với DB đã phục hồi; đối chiếu byte đã lưu, không render lại tài liệu để che mất output. Các kiểm tra DB/HTTP cũ về history, quyền, notification, append-only, idempotency và khả năng ghi tiếp vẫn chạy. Đây chưa phải chứng minh một registry DB thật đã được phục hồi.

## Bằng chứng local

- Lượt thường `8efb6430-8ce8-4e9b-aa99-998adc1fbf68`: PASS, archive riêng `D:\student-service-document-recovery-fake-20261011`, một mẫu và bốn output thật. Lượt này có trước bổ sung bounded-copy; lớp bounded-copy sau đó được kiểm chứng bằng hồi quy và lượt mã hóa cuối.
- Lượt mã hóa đầu `1e1c8b85-ee48-468b-807e-da0dbb8d91ac`: PASS; giữ báo cáo và bản archive cũ, không ghi đè.
- Lượt cuối `d27d0581-e05e-47df-a0a1-e6ddf6453398`: PASS trên mã có bounded-copy; source cluster bị loại bỏ trước giải mã/restore. Một mẫu, bốn output, 26 bảng, 4 sequence giữ nguyên; 50 HTTP request gồm các phép từ chối dự kiến. API/container riêng được dọn theo quyền sở hữu, cleanup=true; file giả và báo cáo trong run được giữ để đối chiếu. Archive mã hóa riêng trên D và key thử ngoài dự án được giữ.
- Hồi quy cuối: 20 fixture + 165 recovery/archive/encryption (gồm 39 ca asset mới) + 6 rào chắn demo, đều đạt. Có một lần thay helper còn sót hai lệnh copyFile làm 11 ca lỗi; đã sửa và chạy lại đầy đủ, không dùng log lỗi làm bằng chứng đạt.
- Ca mới kiểm tra bản Word khi chưa có PDF, duplicate/format/hash/round/mẫu sai, cấm trạng thái ký/phát hành tự khai, path traversal, thiếu/thừa/hỏng, junction, root lồng nhau, nguồn đổi trong dump, đích đã có, output đúng16MiB/quá một byte và giữ output dở khi hash copy sai. Kiểm thử v1 tiếp tục đạt.
- Đã đọc PDF bằng pypdf strict và render/xem đủ trang của hai Word cùng hai PDF phục hồi đại diện: mỗi bản một trang, tiếng Việt, số0/15, Có/Không và binding từng lần gửi đúng, không cắt nội dung. QA `run/document-qa/recovery-v2-plain`.

Log local bị Git bỏ qua: `run/recovery-v2-regression-copy-fixed.log`, `run/document-recovery-real-first.log`, `run/document-recovery-encrypted-real-first.log`, `run/document-recovery-encrypted-real-final.log`, `run/recovery-v2-pdf-validation.log`, `run/recovery-v2-word-render.log`. Báo cáo từng lượt ở `run/recovery-drills/<runId>/report.json`. Khóa và byte giả chỉ nằm ngoài mã nguồn hoặc trong run bị bỏ qua.

## Phần chưa triển khai

B2 đã có migration registry/job và lease/fencing metadata; vẫn cần worker/vault, công bố byte append-only từng định dạng, đọc lại byte đã lưu qua route và fault injection process chết/commit mất phản hồi. Phải thay metadata fixture bằng dữ liệu registry từ cùng DB snapshot, cập nhật audit thật và chứng minh phục hồi registry trước khi bật tính năng. Chưa có cleanup tự động, backup dữ liệu thật, backup sang thiết bị khác, power-loss/TCP/nhiều worker hoặc chữ ký có hiệu lực pháp lý. SHA-256 chỉ đối chiếu byte với metadata; metadata tự nhất quán không chứng minh nguồn gốc hay PDF thật sự được chuyển từ Word khi không có quy trình tin cậy bên ngoài.


Sau migration0023, preflight của rehearsal từ chối registry có bất kỳ hàng nào ở sets/documents/jobs. V1 hoặc v2 fixture không được giả sao lưu output/lease thật. Lượt056c3f7f-aeff-409c-956c-f56f9f318bc0 chỉ chứng minh schema29 bảng/4 sequence cùng registry rỗng phục hồi được; xem nền tảngB2 để tiếp đường phục hồi registry có dữ liệu.
