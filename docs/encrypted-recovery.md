# Bản sao mã hóa và khóa riêng — diễn tập dữ liệu giả

Ngày 10/10/2026. Kho thử: `D:\student-service-fake-encrypted-backups`. Khóa thử được tạo ở thư mục riêng trong LocalAppData của người dùng trên C, ngoài repository và ngoài kho D. Chỉ dùng dữ liệu giả; chưa triển khai backup hồ sơ thật, lịch tự động hoặc quản lý khóa production.

## Phạm vi bảo vệ

Database dump, toàn bộ tệp minh chứng và manifest được mã hóa. Gói trên D chỉ có:

```text
<runId>/
  database.enc
  manifest.enc
  files/<UUID>.enc
  envelope.json
```

`envelope.json` công khai phiên bản, thuật toán, runId/packageId/keyId và descriptor ciphertext của manifest; không chứa khóa, câu trả lời, nội dung hồ sơ hay hash minh chứng gốc. RunId, số lượng/tên UUID và dung lượng ciphertext vẫn quan sát được. Không coi metadata này là ẩn danh hoàn toàn.

Dùng AES-256-GCM với nonce ngẫu nhiên 12 byte, tag cố định 16 byte. Mỗi package có khóa con HKDF-SHA256 từ khóa gốc ngẫu nhiên 32 byte và packageId mới; kiểm tra không trùng nonce trong một package. AAD ràng buộc phiên bản, loại dữ liệu giả, thuật toán, packageId/runId/keyId và tên entry. Manifest mã hóa giữ hash/dung lượng gốc và descriptor các ciphertext; tráo tệp hoặc sửa metadata không vượt qua kiểm tra tương ứng.

Các primitive dùng `node:crypto`. [Tài liệu Node 22](https://nodejs.org/docs/latest-v22.x/api/crypto.html#deciphersetauthtagbuffer-encoding) mô tả xác thực GCM ở `final()` và yêu cầu bỏ kết quả khi xác thực thất bại. Công cụ chỉ đưa kết quả tới bước phục hồi sau khi xác thực **mọi** entry và kiểm tra manifest/layout/hash. Đây là format gói riêng phiên bản 1, chưa có đánh giá mật mã độc lập hay cam kết tương thích với công cụ mã hóa khác.

## Giữ khóa

Lệnh `keygen` sinh khóa ngẫu nhiên, ghi file mới với chế độ tạo độc quyền; không ghi đè khóa cũ, không in nội dung khóa ra terminal/báo cáo. KeyId là mã tham chiếu công khai, không phải khóa. Không lấy khóa từ mật khẩu, biến môi trường hoặc `.env`.

File khóa phải nằm ngoài repository, thư mục khóa phải tách khỏi kho mã hóa; mọi đường dẫn dùng thư mục cha thật, không symlink/junction. Trên POSIX, tạo key file mode 0600 và từ chối key file có quyền group/other. Trên Windows, mode 0600 không thay cho ACL: thư mục khóa của lượt này được tạo mới, tắt kế thừa và chỉ cấp FullControl cho người dùng hiện tại cùng SYSTEM, có kiểm tra ACL. Thư viện dùng chung không tự chứng minh ACL Windows cho một thư mục do người chạy cung cấp; cần cấp và kiểm tra quyền trước khi dùng nơi lưu khác.

Giữ bản dự phòng khóa ở nơi kiểm soát riêng trước khi dùng dữ liệu thật. Mất khóa thì không giải mã được; có cả khóa và gói thì đọc được dữ liệu. Không chuyển khóa cùng kho sao lưu, không đưa lên Git hoặc gửi vào chat. Đổi sang key file mới cho gói mới không làm gói cũ dùng được khóa mới; phải giữ khóa tương ứng keyId của từng gói. Chưa có KMS/HSM, thu hồi/luân chuyển khóa tự động hoặc quy trình khôi phục khóa production.

Khóa C và gói D hiện vẫn trên cùng máy, nên chưa chống mất máy hoặc người có quyền quản trị máy. D cũng là ổ chứa mã nguồn. Mã hóa không tạo thêm độ bền dữ liệu.

## Chạy lại tại máy này

Ghi nhận local không chứa secret nằm ở `run/encrypted-recovery-local.json`; file này chỉ giữ đường dẫn/keyId, Git bỏ qua. Runner không tự nạp file. Từ repository:

```powershell
$taskEncryption = Get-Content run/encrypted-recovery-local.json -Encoding UTF8 | ConvertFrom-Json
npm run rehearse:recovery --workspace @student-service/api -- --archive-root $taskEncryption.archiveRoot --encryption-key $taskEncryption.keyPath
```

`--encryption-key` bắt buộc đi cùng `--archive-root` rõ ràng. Kho mã hóa có dấu nhận diện riêng `fake-encrypted-archive.json`; không trộn với `D:\student-service-fake-backups` chứa gói chưa mã hóa. Thiếu/sai khóa, đường dẫn sai hoặc kho không đúng loại thì dừng; không tự bỏ mã hóa để chạy tiếp. Cờ dữ liệu giả và các guard database/kho thật/production vẫn áp dụng trước khi tạo thư mục lượt chạy hoặc gọi Docker.

Lượt diễn tập tạo hồ sơ giả qua API, dừng nguồn ghi, đóng gói, mã hóa và xác thực. Sau đó **xóa PostgreSQL nguồn giả**, tạo PostgreSQL mới, giải mã gói vào `run/recovery-drills/<runId>/decrypted-bundle` mới, kiểm tra hash gốc, rồi dùng dump/tệp này để phục hồi. Không dùng dump nguồn chưa mã hóa để thay thế bước giải mã. Báo cáo ghi `archive.encrypted=true`, keyId và kiểm tra giải mã sau mất nguồn; không ghi nội dung khóa.

Các lệnh thao tác riêng (script npm đã thêm cờ `--fake-data-only`):

```powershell
npm run recovery:encrypted --workspace @student-service/api -- keygen '<đường dẫn key file mới, trong thư mục riêng đã cấp quyền>'
npm run recovery:encrypted --workspace @student-service/api -- encrypt '<bundle của drill>' '<kho mã hóa>' '<key file>'
npm run recovery:encrypted --workspace @student-service/api -- verify '<package trong kho mã hóa>' '<key file>'
npm run recovery:encrypted --workspace @student-service/api -- decrypt '<package trong kho mã hóa>' '<key file>' '<runRoot của đúng runId>\decrypted-bundle'
```

Nguồn mã hóa phải đúng `run/recovery-drills/<runId>/bundle` của repository. Giải mã chỉ vào thư mục `decrypted-bundle` chưa tồn tại thuộc đúng runId; không nhận đích database/kho ứng dụng thật. Có sẵn package hoặc đích, kể cả thư mục rỗng, thì từ chối. Exit 0 chỉ khi hoàn tất xác thực/thao tác; mọi lỗi exit 1 với mã an toàn, không in secret. `verify` chỉ xác thực package đã chọn; **chưa có catalog/retention cho kho mã hóa**. Báo cáo runner ghi `retentionSupported=false`; công cụ kho chưa mã hóa không được dùng để dọn kho này.

## Kết quả

Lượt `61142611-df4f-4324-89a7-ec6d5b7dc6fd` đạt, cleanup thành công. Báo cáo: `run/recovery-drills/61142611-df4f-4324-89a7-ec6d5b7dc6fd/report.json`; log: `run/encrypted-recovery-full.log`.

| Nội dung                         | Kết quả                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Nguồn đã mất trước giải mã       | PostgreSQL nguồn giả đã xóa; đích là cluster mới                                                       |
| Gói trước mã hóa                 | Dump 111,856 byte; 2 tệp tổng 75 byte, gồm tệp đã gỡ mềm                                               |
| Mã hóa/xác thực/chuyển vào kho D | 159 ms                                                                                                 |
| Dựng đích, giải mã và phục hồi   | 4857 ms                                                                                                |
| Đối chiếu                        | 26 bảng, 4 sequence, chỉ mục/ràng buộc/trigger/extension khớp                                          |
| Nghiệp vụ/quyền                  | 42 yêu cầu HTTP; lịch sử/tệp/thông báo, ghi tiếp, chặn truy cập ngoài phạm vi và thu hồi quyền đều đạt |
| Toàn lượt                        | 17834 ms, không suy ra RTO/RPO cho dữ liệu thật                                                        |

94 test gói/guard đạt, gồm 63 test có sẵn và 31 test mã hóa: khôi phục byte đúng, không lộ plaintext trong các tệp mã hóa, không ghi đè, sai keyId/sai secret với cùng keyId, ciphertext/manifest hỏng hoặc thiếu, tag ngắn, header đổi, tráo tệp, hash ciphertext được tính lại nhưng tag sai, manifest có key vượt kho/trùng entry/nonce trùng/ngày sai/không phải dữ liệu giả, junction, vị trí khóa/đích sai và guard CLI. Bổ sung kiểm tra mất khóa, key file sai/không phải dữ liệu giả và thiếu khóa không được tự bỏ mã hóa. Lệnh diễn tập chạy bộ 90 test lúc đó; bộ cuối 94 test được chạy lại sau khi bổ sung các trường hợp guard, đều đạt; lint script, build API và format/diff được kiểm tra cho increment này. Không đổi source ứng dụng/schema/giao diện và không chạy lại toàn bộ hồi quy ứng dụng.

Chế độ chưa mã hóa cũng được diễn tập lại và đạt: `run/recovery-drills/85d387f0-c561-4025-a867-bfd233087309/report.json`, log `run/encrypted-recovery-plain-regression.log`; 26 bảng/4 sequence và các kiểm chứng nghiệp vụ/quyền vẫn đạt.

Các lệnh `keygen`, `verify`, `encrypt`, `decrypt` được thử độc lập và đạt: `run/encrypted-recovery-cli-verify.json`, `run/encrypted-recovery-cli-encrypt.json`, `run/encrypted-recovery-cli-decrypt.json`. Lượt CLI mã hóa thêm gói của runId `dbf51365-9a14-43ec-a1bf-97bdddf42d30`, rồi giải mã vào đúng drill của gói đó; không ghi đè gói mới dùng trong diễn tập đầy đủ.

## Giới hạn và xử lý lỗi

Gói mã hóa được ghi độc quyền, envelope hoàn tất được ghi cuối. Chép/mã hóa thất bại giữ phần ciphertext dở; gói đó không được coi là đạt. Khi giải mã, lượt đầu xác thực toàn bộ tới bộ nhận bỏ dữ liệu; sau đó mới tạo đích và xác thực lại lúc ghi. Lỗi được xử lý sau khi tạo đích sẽ dọn đúng thư mục mới do lượt đó tạo, không xóa thư mục có sẵn. Nếu tiến trình bị tắt cưỡng bức, plaintext dở có thể còn lại; chỉ dùng thư mục diễn tập riêng và kiểm tra trước khi sử dụng kết quả.

Nguồn gói, dump nguồn, các gói thử **chưa mã hóa trước đó** và plaintext đã giải mã vẫn tồn tại trong phạm vi dữ liệu giả. Increment này không tự chuyển đổi hoặc xóa chúng, không có xóa an toàn, khóa bộ nhớ hoặc bảo đảm xóa secret khỏi RAM. Không tuyên bố toàn máy hoặc mọi bản sao cũ đã được mã hóa.

Giới hạn: tối đa 5.000 tệp, 5 MiB/tệp, dump 512 MiB; manifest mã hóa tối đa 4 MiB, envelope 4 KiB. Đọc/ghi payload theo luồng; manifest nhỏ được giữ trong RAM. Kho/nguồn/thư mục tạm phải do người vận hành tin cậy kiểm soát; stat/hash không chống người có quyền sửa filesystem trong lúc chạy. Chưa kiểm thử mất điện, thiết bị từ xa, dung lượng đại diện, đồng bộ bền vững, kho bất biến hoặc retention mã hóa.

Xác thực gói mã hóa là cơ chế bảo vệ bản sao, không phải xác minh chữ ký số trên giấy tờ hoặc công nhận hiệu lực dấu đỏ. Giấy xác nhận sinh viên tiếp tục làm trực tiếp tại CTSV. Các việc trước production trong [runbook phục hồi](recovery-rehearsal.md) và [kho riêng](recovery-archive.md) vẫn còn hiệu lực.
