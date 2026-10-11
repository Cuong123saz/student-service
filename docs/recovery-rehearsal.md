# Diễn tập sao lưu và phục hồi hồ sơ bằng dữ liệu giả

Ngày: 10/10/2026. Phạm vi: công cụ local có thể chạy lại; không phải triển khai backup cho dữ liệu thật, không tự đóng Sprint4/5.

## Kết quả đã chứng minh

Lượt diễn tập tạo hồ sơ qua API thật, dừng nguồn ghi, sao lưu cả database và kho minh chứng, **xóa container database nguồn giả**, rồi khôi phục vào PostgreSQL mới. Database development/test hiện có không được dùng làm nguồn hoặc đích.

Bộ dữ liệu hiện dùng [mẫu đúng kiểu](typed-recovery-fixtures.md), gồm đủ sáu kiểu trường và PDF đã phân tích/render độc lập.

Bộ dữ liệu gồm 4 tài khoản giả (chủ hồ sơ, sinh viên khác, cán bộ đúng đơn vị và cán bộ khác đơn vị), 1 thủ tục ONLINE giả riêng, 1 hồ sơ, 2 lần gửi, 4 sự kiện và 2 tệp PDF giả. Tệp lần 1 đã gỡ mềm ở bản đang xử lý nhưng còn trong lịch sử; tệp lần 2 đang dùng. Sau bổ sung, hồ sơ quay về người đang xử lý nên gọi nhận lại không tạo thêm sự kiện CLAIMED.

| Nội dung                                     | Kết quả                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Database nguồn đã mất trước phục hồi         | Có; container mới có ID khác, cùng image PostgreSQL                                                       |
| Dữ liệu mọi bảng public và journal migration | 26 bảng, số dòng và SHA-256 từng bảng khớp                                                                |
| Sequence                                     | 4 sequence khớp `last_value`/`is_called`; insert mới dùng ID tiếp theo hợp lệ                             |
| Chỉ mục, ràng buộc, trigger, extension       | Khớp sau chuẩn hóa biểu diễn cast literal nêu bên dưới                                                    |
| Minh chứng                                   | 2/2 byte gốc khớp dung lượng và SHA-256, gồm tệp đã gỡ                                                    |
| Hồ sơ, lịch sử, thông báo                    | API trả đúng dữ liệu trước sao lưu                                                                        |
| Quyền tải tệp                                | Owner và cán bộ đúng phạm vi tải được tệp hiện tại/lịch sử; sinh viên khác và cán bộ ngoài đơn vị bị chặn |
| Tệp đã gỡ                                    | Route tệp hiện tại trả 404; route lịch sử vẫn trả byte đúng khi có quyền                                  |
| Ghi tiếp sau phục hồi                        | Duyệt hồ sơ giả thành công; gọi lặp chỉ có 1 event, 1 audit và 1 thông báo mới                            |
| Thu hồi quyền hiện tại                       | Bỏ scope của cán bộ giả; phiên cũ tải tệp bị chặn 403                                                     |
| Giữ lịch sử bất biến                         | UPDATE round và DELETE event bị chặn; dữ liệu không đổi                                                   |
| Giả lập tệp bị sửa                           | Download trả 503, audit phát hiện HASH_MISMATCH; trả lại byte giả đúng và kiểm tra đạt                    |
| Cleanup                                      | API riêng đã dừng, container riêng đã xóa; gói dữ liệu giả và báo cáo được giữ để xem lại                 |

Lượt ban đầu có 42 yêu cầu HTTP trong cả quá trình tạo và kiểm chứng: 29×200, 1×401, 2×403, 9×404 và 1×503 được cố ý gây ra bằng sửa byte tệp giả. Không phải kiểm thử tải hoặc 42 unit test.

PostgreSQL có thể deparse `(ARRAY['ACTIVE'::varchar, ...])::text[]` thành `ARRAY[('ACTIVE'::varchar)::text, ...]` sau dump/restore. Bộ đối chiếu chỉ chuẩn hóa đúng danh sách **literal character varying → text** này; giữ mọi literal và mọi SQL còn lại để so sánh. Có test xác nhận thay giá trị hoặc biểu thức khác không bị bỏ qua. Không loại bỏ ràng buộc khỏi kiểm tra chỉ vì khác chuỗi biểu diễn.

## Số đo local của lượt đầu, trước bước chép sang kho riêng

Node 22.23.2, PostgreSQL 17.10 trong image local `postgres:17-alpine`. Gói có database dump 111,843 byte và 2 tệp tổng 75 byte. Đây là các byte giả chỉ có header PDF để kiểm thử nghiệp vụ, chưa phải PDF hoàn chỉnh. Đã thay trong bộ mẫu hiện tại; số đo lịch sử này không đổi.

| Giai đoạn                                                   | Thời gian |
| ----------------------------------------------------------- | --------- |
| Sao lưu database và kho tệp, kiểm tra gói                   | 571 ms    |
| Xóa nguồn giả, tạo PostgreSQL mới, phục hồi database và tệp | 4102 ms   |
| Đối chiếu dữ liệu/quyền và các kiểm tra sau phục hồi        | 4176 ms   |
| Toàn lượt, gồm tạo nguồn, migrate, tạo hồ sơ giả và cleanup | 17145 ms  |

Không suy ra RTO/RPO, capacity hoặc SLA production từ bộ dữ liệu nhỏ này. Chưa đo thời gian phục hồi dữ liệu thật, mất máy chủ, mất ổ đĩa, kho từ xa hoặc khả năng sao lưu ngoài máy.

## Chạy lại

Yêu cầu Node 22 theo repository, dependency đã cài, Docker đang chạy và image `postgres:17-alpine` đã có local. Công cụ dùng `--pull=never`, không tự tải image. Không cần cài riêng `pg_dump`/`pg_restore` trên Windows.

Từ repository, dùng terminal không nạp cấu hình database/kho tệp của ứng dụng:

```powershell
npm run rehearse:recovery --workspace @student-service/api
```

Lệnh chạy toàn bộ test gói/guard (hiện 146 test, gồm 20 test dữ liệu giả đúng kiểu, 94 test gói/kho riêng, tùy chọn nơi lưu và mã hóa, cùng 32 test kiểm tra toàn kho mã hóa), build API rồi gọi runner với cờ bắt buộc `--fake-data-only`. Runner nhận `--archive-root <đường dẫn tuyệt đối>` cho kho giả và có thể thêm `--encryption-key <key file>` khi chọn kho mã hóa riêng; key bắt buộc đi cùng nơi lưu rõ ràng. Đối số khác bị từ chối. Xem [diễn tập mã hóa](encrypted-recovery.md) để chọn đúng loại kho và giữ khóa. Runner từ chối biến `DATABASE_URL` hoặc `SUBMISSION_STORAGE_ROOT` kế thừa, và `APP_ENV=production` **trước khi tạo thư mục hoặc gọi Docker**. Không đọc `.env` của dự án. Các child API chỉ nhận cấu hình giả, khóa phiên sinh ngẫu nhiên và `fake.env` trống; không chạy worker/email.

Runner tự tạo thư mục `run/recovery-drills/<runId>` mới và container có tên/label cùng runId. Chỉ publish PostgreSQL lên `127.0.0.1` với cổng tự cấp, không dùng 5433/5434. Data PostgreSQL ở tmpfs, không mount ổ đĩa/kho thật. Trước mỗi lần xóa, kiểm tra ID, tên, label, image và không có persistent mount; không xóa container khác hoặc dùng prune/reset.

Database nguồn/đích có tên riêng cố định trong container mới của lượt chạy. Không nhận URL database hoặc đường dẫn đích phục hồi do người chạy cung cấp. Tùy chọn `--archive-root` chỉ chọn kho bản sao giả; đích database/tệp phục hồi vẫn do runner tạo mới và kiểm soát. Runner hiện bổ sung bước chép và kiểm tra gói ngoài dự án rồi phục hồi từ bản đã chép; xem [kho riêng và đề xuất giữ bản cũ](recovery-archive.md) để biết kết quả mới và giới hạn. Nguồn API phải đóng sạch, không còn session khác và database mặc định READ ONLY trước khi đóng gói. Gói gồm:

```text
bundle/
  database.dump
  files/<UUID>
  manifest.json
```

Tất cả tệp UUID trong kho được sao chép, gồm byte đã gỡ hoặc chưa liên kết; không xóa dựa trên metadata. Manifest ghi size/SHA-256 của dump và từng tệp, được ghi sau khi copy/dump hoàn tất và kiểm tra lại nguồn. Mỗi lần dùng gói đều kiểm tra lại toàn bộ hash, layout, key và giới hạn. Gói thiếu/sai không được phục hồi.

Dùng custom-format `pg_dump` và `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges`. Dump được truyền dưới dạng byte stream, không qua chuyển mã văn bản của shell. PostgreSQL mô tả snapshot nhất quán của database tại [pg_dump 17](https://www.postgresql.org/docs/17/app-pgdump.html) và chế độ transaction/lỗi của [pg_restore 17](https://www.postgresql.org/docs/17/app-pgrestore.html). Việc dừng writer để đồng bộ thêm kho tệp nằm ngoài database là lựa chọn của công cụ diễn tập này.

Nơi phục hồi phải mới: database không có relation/function/extension tùy biến/schema khác; thư mục đích chưa tồn tại. Không dùng `--clean`, không phục hồi đè. SHA-256/manifest phát hiện byte sai trong phạm vi kiểm tra; manifest chưa ký và chưa mã hóa, không chứng minh gói từ nguồn tin cậy nếu cả gói và manifest bị thay đổi.

## Báo cáo và xử lý thất bại

`RECOVERY_RESULT` chỉ ra đường dẫn `report.json`; exit 0 và `status=PASS` chỉ xuất hiện khi mọi kiểm tra và cleanup hoàn tất. Khi lỗi, exit 1, báo cáo ghi phase/code và `cleanup`; không đánh dấu đạt chỉ vì pg_restore kết thúc. Bản sao dở dang thiếu manifest hoặc sai hash sẽ bị từ chối ở lần kiểm tra sau.

Giữ thư mục của lượt thất bại để xem `commands.log`, `source-api.log`/`restored-api.log`, báo cáo và snapshot đối chiếu (chỉ hash/count và cấu trúc). Sửa nguyên nhân rồi chạy lượt mới với runId mới; không sửa manifest/hash để làm gói hỏng thành đạt, không phục hồi đè thư mục cũ. Nếu tiến trình bị tắt cưỡng bức hoặc Docker ngừng giữa chừng, khối cleanup có thể chưa chạy. Kiểm tra container bằng label `student-service.recovery-id=<runId>` và đối chiếu ID/tên/image trước khi dọn đúng container của lượt đó; không dọn theo tên gần giống.

Giới hạn công cụ diễn tập: tối đa 5.000 tệp UUID, 5 MiB/tệp, dump 512 MiB, manifest 2 MiB. Kho tệp phải do người vận hành tin cậy kiểm soát; stat/hash và READ ONLY của nguồn giả không phải cơ chế snapshot liên hệ thống cho production hoặc chống người có quyền sửa ổ đĩa/superuser.

## Kiểm thử và bằng chứng

22 test gói/guard đạt: bản sao đủ và khôi phục mới, không ghi đè, dump thất bại, nguồn đổi/còn writer, tệp thiếu/sai byte, dump sai, extra entry, key vượt kho/trùng, manifest không phải dữ liệu giả, junction, container khác/persistent mount, URL không hợp lệ, đích không trống, cấu hình bên ngoài và chuẩn hóa biểu diễn SQL. Test này nằm trong `npm run test` của API nên CI chạy; lượt Docker đầy đủ là lệnh diễn tập riêng, không tự chạy cùng integration test.

22 test đối chiếu kho minh chứng có sẵn được chạy lại và đạt. Typecheck, lint ứng dụng, lint riêng 5 script mới, build API và format/diff được kiểm tra cho increment này. Không đổi source ứng dụng/schema/giao diện, không chạy lại toàn bộ hồi quy ứng dụng để thay thế bằng các số liệu cũ.

Lượt độc lập đạt: `run/recovery-drills/70422dcc-e980-446b-9342-58b4e1812a75/report.json`; log `run/recovery-independent-run.log`, `run/recovery-bundle-tests.log`, `run/recovery-storage-tests.log`, `run/recovery-scripts-lint.log`. `run/` được Git bỏ qua; không commit gói, file giả, khóa hoặc báo cáo vận hành.

## Việc còn lại trước dữ liệu thật

Diễn tập này hoàn thành đường đi phục hồi bằng dữ liệu giả. Đã bổ sung [công cụ kho riêng và đề xuất retention](recovery-archive.md) bằng dữ liệu giả; chưa thử trên ổ cứng ngoài/máy khác thực tế. Còn phải chốt cơ chế ngừng mọi nguồn ghi của môi trường thật, nơi sao lưu riêng có kiểm soát truy cập/mã hóa, lịch backup và retention, giám sát lỗi/kiểm tra định kỳ, cách dựng lại role/quyền database và secret vận hành, và đo phục hồi với dung lượng đại diện. `pg_dump` chỉ sao lưu một database, không bao gồm global roles/tablespaces; công cụ này dùng role postgres của container giả mới theo phạm vi thử, không kiểm chứng quyền vận hành production.

Kho bền vững, quét mã độc và xác minh chữ ký vẫn là các việc riêng theo [ADR0003](adr/0003-student-drafts-and-evidence.md). Giấy xác nhận sinh viên tiếp tục làm trực tiếp tại CTSV; không đổi cấu hình development để tạo dữ liệu thử.


## Bổ sung recovery v2

[Phép thử mẫu và output riêng](document-recovery-v2.md) dùng cờ --document-assets, giữ tương thích v1. Lượt mã hóa cuối d27d0581-e05e-47df-a0a1-e6ddf6453398 đã phục hồi một mẫu và bốn Word/PDF thật cùng 26 bảng/4 sequence. Metadata tài liệu hiện là TECHNICAL_FIXTURE, chưa có registry DB hoặc route tải cố định; không gộp kết quả này với nghiệm thu chức năng phát hành.
