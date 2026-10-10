# Kiểm tra toàn kho mã hóa và đề xuất giữ bản sao giả

Ngày 10/10/2026. Phạm vi: kho diễn tập riêng `D:\student-service-fake-encrypted-backups`; chỉ dùng dữ liệu giả. Công cụ chỉ đọc, không xóa, không chuyển đổi bản sao và không ghi plaintext đã giải mã xuống đĩa.

## Dùng tại máy này

Từ thư mục dự án, dùng ghi nhận local đã có để chọn kho và khóa; không in nội dung khóa:

```powershell
$taskEncryption = Get-Content run/encrypted-recovery-local.json -Encoding UTF8 | ConvertFrom-Json
npm run recovery:encrypted --workspace @student-service/api -- inspect $taskEncryption.archiveRoot $taskEncryption.keyPath 3 30
```

Hai số cuối là giữ ít nhất **3 bản mới nhất** và bảo vệ mọi bản **chưa đủ 30 ngày**. Đây là chính sách thử được truyền rõ ràng, chưa phải chính sách retention dữ liệu thật. Lệnh npm đã thêm cờ bắt buộc `--fake-data-only`.

Mỗi gói phải qua `verifyEncryptedRecoveryBundle`: xác thực manifest và mọi ciphertext bằng GCM, đối chiếu layout, runId, ngày tạo, dung lượng và SHA-256 gốc. Ngày/số lượng/dung lượng trong báo cáo của gói VERIFIED lấy từ manifest đã xác thực, không dùng riêng envelope công khai để kết luận gói khỏe. Công cụ xử lý lần lượt, không tạo thư mục phục hồi hoặc ghi tệp tạm plaintext. Khóa và manifest nhỏ vẫn được đọc vào bộ nhớ như bộ xác thực sẵn có.

## Đọc kết quả

| Trạng thái   | Ý nghĩa                                                                          | Exit code |
| ------------ | -------------------------------------------------------------------------------- | --------- |
| OK           | Tất cả gói đều xác thực bằng khóa đã chọn                                        | 0         |
| ATTENTION    | Có gói lỗi, gói chưa xác minh được hoặc mục lạ trong kho                         | 2         |
| EMPTY        | Kho có dấu nhận diện hợp lệ nhưng chưa có gói                                    | 2         |
| Lỗi thao tác | Thiếu khóa/kho, đường dẫn hoặc tham số không hợp lệ, môi trường bị guard từ chối | 1         |

Từng gói có trạng thái:

- `VERIFIED`: toàn bộ gói đã qua xác thực và đối chiếu. Không đồng nghĩa đã thử khôi phục PostgreSQL trong lần quét này.
- `INVALID`: gói không vượt qua kiểm tra; ví dụ ciphertext hỏng, thiếu tệp, layout sai hoặc tên thư mục không khớp runId đã xác thực. Báo cáo chỉ trả mã lỗi an toàn, không in chi tiết nội bộ.
- `UNVERIFIED` / `KEY_UNAVAILABLE_FOR_PACKAGE`: envelope khai báo keyId khác khóa được chọn. Có thể cần khóa khác hoặc envelope đã bị sửa; metadata chưa được xác thực nên chưa kết luận gói hỏng hay khỏe. Một lần quét hiện chỉ nhận **một khóa**; chưa có keyring/luân chuyển khóa tự động.

Nếu có bất kỳ mục INVALID/UNVERIFIED, mọi gói VERIFIED nhận `KEEP` với lý do `ARCHIVE_REQUIRES_ATTENTION`; số CANDIDATE bằng 0. Không đề xuất loại bỏ gói đã xác minh chỉ vì các bản còn lại chưa thể kiểm tra.

Khi toàn kho OK, sắp gói theo ngày tạo giảm dần, nếu trùng ngày thì runId tăng dần để kết quả ổn định. Bảo vệ số bản mới nhất trước; các bản còn lại chỉ nhận `CANDIDATE` khi đủ tuổi. CANDIDATE là đề xuất xem xét, không phải lệnh xóa. Các trường `deletionPerformed=false` và `restoreTestedByThisInspection=false` luôn được ghi rõ.

Công cụ từ chối kho trong/chứa repository, thư mục không có marker mã hóa, junction/symlink, khóa cùng cây thư mục kho, chính sách sai và quá 10.000 mục. Tên mục lạ không được in lại vì có thể chứa thông tin cá nhân. Kiểm tra lại quyền sở hữu thư mục và danh sách mục cuối lượt để chặn thay đổi quan sát được. Đây không phải snapshot nguyên tử của filesystem: cần dừng tiến trình ghi vào kho trong lúc quét, dùng thư mục do người vận hành tin cậy kiểm soát.

Thiếu/sai định dạng khóa thì lỗi thao tác, không được trả OK/EMPTY. Khóa có cùng keyId nhưng sai secret không xác thực được gói và dẫn tới ATTENTION. Các guard DATABASE_URL, SUBMISSION_STORAGE_ROOT và APP_ENV=production vẫn áp dụng; không đọc cấu hình database thật để quét thử.

## Kết quả tại máy này

Đã chạy CLI trên ba gói giả có sẵn tại D:

| Nội dung                        | Kết quả                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| Trạng thái                      | OK, exit 0                                                      |
| VERIFIED / INVALID / UNVERIFIED | 3 / 0 / 0                                                       |
| CANDIDATE                       | 0 theo chính sách 3 bản mới nhất, 30 ngày                       |
| Không đổi bản sao               | Đối chiếu layout, dung lượng và SHA-256 mọi tệp trước/sau: khớp |
| Tệp giải mã mới                 | Không tạo                                                       |

Hai gói cũ giữ các byte minh chứng tối thiểu của lượt thử trước; catalog xác thực gói/hash, không chứng nhận cấu trúc PDF hoặc kiểu dữ liệu nghiệp vụ bên trong dump. Bộ PDF và câu trả lời đúng kiểu hiện tại nằm trong gói `eb48374d-b029-48da-ace7-7b1f59cf42e2`, xem bằng chứng ở [bộ mẫu đúng kiểu](typed-recovery-fixtures.md). Không sửa lại các bản sao lịch sử chỉ để làm đẹp kết quả.

Báo cáo local bỏ qua Git: `run/encrypted-archive-inspection.json`. Probe kiểm tra byte trước/sau: `run/check-encrypted-archive-readonly.mjs`.

**146 kiểm thử đạt**: 20 test bộ mẫu đúng kiểu, 94 test gói/guard/mã hóa đã có và 32 test catalog mới. Các ca mới kiểm tra thứ tự/ngưỡng tuổi, số bản tối thiểu, kho rỗng/không tồn tại, ciphertext/manifest hỏng, thiếu minh chứng, khóa khác/sai secret, tên mục lạ được che, runId không khớp, thời điểm kiểm tra bất hợp lý, junction, tham số/chính sách sai, CLI/guard và không thay đổi dữ liệu. Log `run/encrypted-archive-recovery-tests.log`; lint script, typecheck API, build API, format/diff và ADR gate đều được kiểm tra.

Không đổi API nghiệp vụ, schema database hoặc giao diện. Không chạy lại toàn bộ hồi quy ứng dụng hoặc diễn tập xóa nguồn PostgreSQL trong increment này; bằng chứng phục hồi gần nhất vẫn là [lượt dữ liệu đúng kiểu](typed-recovery-fixtures.md). Runner phục hồi chưa tích hợp quét toàn kho: trường `retentionSupported=false` trong báo cáo runner chưa được thay đổi. Công cụ inspect này là thao tác riêng; chưa triển khai lịch tự động, thao tác xóa hoặc backup dữ liệu thật.
