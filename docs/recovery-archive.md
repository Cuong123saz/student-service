# Lưu bản sao riêng và đề xuất giữ bản cũ — dữ liệu giả

Ngày 10/10/2026. Người dùng chọn lưu thử trên **ổ D**, tại `D:\student-service-fake-backups`. Windows nhận D là ổ cố định (NTFS), và mã nguồn cũng trên D. Đây là kho cục bộ; chưa kiểm chứng ổ ngoài hoặc máy khác, chưa triển khai sao lưu production hoặc lịch chạy.

## Công cụ làm gì

`recovery:archive export` nhận gói dữ liệu giả đã tạo bởi [diễn tập phục hồi](recovery-rehearsal.md), chép cả database dump và mọi tệp minh chứng vào một thư mục riêng ngoài repository, rồi kiểm tra toàn bộ dung lượng/SHA-256. Nguồn phải đúng `run/recovery-drills/<runId>/bundle` của repository. Không nhận database URL, không đọc `.env`, không kết nối database, không sao lưu kho đang hoạt động.

Nơi lưu có cấu trúc:

```text
<archiveRoot>/
  fake-recovery-archive.json
  <runId>/
    database.dump
    files/<UUID>
    manifest.json
```

Thư mục cha phải tồn tại; `archiveRoot` có thể là thư mục mới, hoặc kho giả đã có đúng dấu nhận diện. Công cụ từ chối thư mục có sẵn không thuộc kho giả, đường dẫn tương đối, đường dẫn nằm trong/bao quanh repository, symlink/junction ở kho hoặc đường dẫn cha. Không tạo đệ quy một cây thư mục tùy ý. Dấu nhận diện chỉ ngăn thao tác nhầm, không phải chứng thực nguồn gốc hay cơ chế phân quyền.

Mỗi runId chỉ được chép một lần. Có sẵn đích, kể cả đích chép dở, thì dừng; không ghi đè. Copy dùng chế độ tạo độc quyền, kiểm tra byte đã chép và kiểm tra lại nguồn trước khi chép manifest cuối cùng. Khi lỗi, giữ phần đã chép để kiểm tra; không tự xóa hay sửa hash cho đạt. Gói cần được kiểm tra lại mỗi lần sử dụng, kể cả khi đã có manifest.

## Đề xuất giữ bản cũ

`recovery:archive inspect` chỉ đọc. Nó kiểm tra toàn bộ từng gói, lập danh sách theo ngày tạo, rồi áp dụng hai điều kiện bảo vệ:

- Giữ ít nhất `keepLatest` bản mới nhất đã kiểm tra đạt; tối thiểu cho phép là 1.
- Giữ mọi bản chưa đủ `minAgeDays` chu kỳ 24 giờ tính từ thời điểm tạo, tối thiểu là 1 ngày.

Bản nằm ngoài cả hai điều kiện mới có đề xuất `CANDIDATE`. Đây là danh sách để người vận hành xem xét; **không có lệnh xóa**. Khi có bất kỳ gói thiếu/hỏng, runId không khớp thư mục, ngày tạo sai/ở tương lai, junction hoặc entry lạ, toàn kho trả `ATTENTION` và số ứng viên bằng 0. Kho không có bản nào trả `EMPTY`, không coi là có backup sử dụng được.

Chính sách **3 bản mới nhất và tuổi tối thiểu 30 ngày** chỉ là cấu hình mẫu trong diễn tập. Không phải quy định lưu trữ hồ sơ của học viện. Thời gian tạo trong manifest chưa được ký; không dùng báo cáo này làm căn cứ xóa tự động. Tệp đã gỡ mềm trong hồ sơ vẫn được giữ nguyên trong gói cùng các bản lịch sử.

Báo cáo ghi `deletionPerformed=false` và `restoreTestedByThisInspection=false`. Kiểm tra hash đạt chưa chứng minh gói phục hồi thành công; việc đó do lượt diễn tập PostgreSQL riêng thực hiện.

## Chạy thử

Từ `D:\student-service`, dùng terminal không nạp `DATABASE_URL` hoặc `SUBMISSION_STORAGE_ROOT` và không đặt `APP_ENV=production`:

```powershell
npm run rehearse:recovery --workspace @student-service/api
```

Nếu không truyền nơi lưu, runner tự tạo kho dữ liệu giả riêng trong thư mục tạm hệ điều hành, ngoài repository. Nó chép gói tới đó, kiểm tra gói, **xóa container PostgreSQL nguồn giả**, tạo PostgreSQL mới và phục hồi database/tệp từ **bản đã chép**. Kho giả được giữ lại; đường dẫn cụ thể nằm ở `report.json` → `archive.root`. Thư mục tạm vẫn ở cùng máy và có thể bị hệ điều hành dọn; không phải kho sao lưu vận hành.

Để các lượt mới lưu và phục hồi từ đúng kho trên D đã chọn:

```powershell
npm run rehearse:recovery --workspace @student-service/api -- --archive-root 'D:\student-service-fake-backups'
```

`--archive-root` nhận một đường dẫn tuyệt đối. Không hardcode D trong mã nguồn và không tự đọc cấu hình local hoặc `.env` để chuyển nơi lưu. Thiếu đường dẫn, đường dẫn tương đối, đối số thừa, nguồn cấu hình database/kho thật, nơi lưu trong repository, thư mục cha thiếu hoặc kho có sẵn không đúng dấu nhận diện đều bị từ chối trước khi tạo thư mục lượt chạy/gọi Docker. Kiểm tra trước chỉ đọc cấu trúc/đường dẫn/dấu nhận diện; lỗi ghi, mất kết nối hoặc hết dung lượng phát sinh khi chép vẫn làm lượt chạy thất bại và giữ phần chép dở.

Có thể dùng lại cùng kho cho nhiều runId. Công cụ kiểm tra các bản có sẵn sau khi chép gói mới; gói mới phải được giữ theo chính sách mẫu. Nếu kiểm tra kho trả `ATTENTION`, dừng trước bước xóa PostgreSQL nguồn giả. Báo cáo ghi `archive.selection=EXPLICIT` khi chọn nơi lưu, hoặc `TEMPORARY` khi dùng thư mục tạm. Các lựa chọn này chỉ áp dụng cho dữ liệu giả, không bật lịch hay sao lưu dữ liệu thật.

Để chép thủ công một gói diễn tập vào kho mới ngoài dự án:

```powershell
$taskRunId = '<runId của lượt diễn tập>'
$taskBundle = Join-Path (Get-Location).Path ('run\recovery-drills\' + $taskRunId + '\bundle')
$taskArchiveRoot = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'student-service-fake-manual-' + [guid]::NewGuid().ToString())
npm run recovery:archive --workspace @student-service/api -- export $taskBundle $taskArchiveRoot
npm run recovery:archive --workspace @student-service/api -- inspect $taskArchiveRoot 3 30
```

Thay runId bằng kết quả thực tế. Khi có ổ cứng ngoài hoặc thư mục chia sẻ đã gắn vào máy, có thể thay `$taskArchiveRoot` bằng đường dẫn tuyệt đối tới **thư mục dành riêng cho dữ liệu giả**, có thư mục cha tồn tại. Không ghi đường dẫn/secret vào `.env` của ứng dụng. Công cụ chưa kiểm chứng kết nối hay quyền truy cập thiết bị của người dùng; không tự mount ổ mạng hoặc yêu cầu mật khẩu.

Lệnh trực tiếp là `node apps/api/scripts/manage-recovery-archive.mjs --fake-data-only export <bundle> <archive>` hoặc `... --fake-data-only inspect <archive> <keepLatest> <minAgeDays>`. Script npm đã thêm cờ dữ liệu giả. Sai cờ/đối số hoặc kế thừa cấu hình database/kho thật/production thì từ chối trước thao tác tệp.

Exit code: 0 khi export đạt hoặc inspect `OK`; 2 khi inspect `ATTENTION`/`EMPTY`; 1 khi cấu hình sai hoặc không hoàn tất. Lỗi CLI chỉ trả mã an toàn, không in URL database/secret hoặc nội dung hồ sơ. Không có lịch, worker, upload mạng hay hành động xóa kèm theo.

## Kết quả kiểm chứng

Lượt `d2e33a24-bd8a-49f5-a718-84e012497e20` đạt, cleanup thành công. Báo cáo local: `run/recovery-drills/d2e33a24-bd8a-49f5-a718-84e012497e20/report.json`; log `run/archive-rehearsal.log`.

| Nội dung                   | Kết quả                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------ |
| Gói nguồn                  | Dump 111.861 byte; 2 tệp tổng 75 byte, gồm tệp đã gỡ mềm                             |
| Chép và kiểm tra kho riêng | Đạt; 75 ms trong lượt giả này                                                        |
| Phục hồi từ bản đã chép    | Đạt sau khi PostgreSQL nguồn giả bị xóa; 5.295 ms gồm dựng PostgreSQL mới            |
| Dữ liệu/cấu trúc           | 26 bảng, 4 sequence, chỉ mục, ràng buộc, trigger và extension khớp                   |
| Nghiệp vụ/quyền            | 42 yêu cầu HTTP; lịch sử/tệp/thông báo đúng, quyền tải/thu hồi quyền và ghi tiếp đạt |
| Toàn lượt                  | 20.797 ms; không dùng để cam kết RTO/RPO production                                  |
| Kiểm tra kho sau thử       | Bản nguồn và bản ngoài dự án còn nguyên; không đề xuất dọn bản duy nhất              |

Hai lệnh npm export/inspect cũng được chạy độc lập với một kho tạm giả khác và đạt: `run/archive-cli-export.log`, `run/archive-cli-inspect.log`. Các lượt này dùng thư mục tạm. Lượt dùng ổ D được ghi riêng bên dưới; chưa thử trên ổ cứng ngoài hoặc máy khác.

54 test gói/guard đạt, gồm 22 test trước đó và 32 test kho/retention mới: khôi phục sau khi xóa gói nguồn trong fixture, không ghi đè, giữ bản mới/đủ tuổi, đúng ranh giới tuổi, chặn đề xuất khi gói hỏng/dở/entry lạ, path/junction, nguồn không phải drill, cấu hình không hợp lệ, manifest null, kho trống và dấu nhận diện bị sửa. `npm run test` của API bao gồm bộ này; diễn tập Docker đầy đủ là lệnh riêng.

22 test đối chiếu kho minh chứng có sẵn, typecheck, lint ứng dụng, lint script, build API và kiểm tra format/diff được chạy cho increment này. Không đổi schema/luồng ứng dụng/giao diện; không chạy lại toàn bộ hồi quy ứng dụng. Gói, báo cáo và log local không được commit.

## Diễn tập toàn bộ từ ổ D

Lượt `dbf51365-9a14-43ec-a1bf-97bdddf42d30` đạt, cleanup thành công; báo cáo `run/recovery-drills/dbf51365-9a14-43ec-a1bf-97bdddf42d30/report.json`, log `run/recovery-d-full.log`. Lượt này truyền `--archive-root D:\student-service-fake-backups`; `archive.selection=EXPLICIT`. Kho trên D có 2 gói hợp lệ: gói cũ giữ nguyên và gói mới được kiểm tra, không có ứng viên dọn.

Sau khi chép, runner xóa PostgreSQL nguồn giả rồi dùng **database.dump và kho tệp trên D** phục hồi vào PostgreSQL mới. 26 bảng, 4 sequence, ràng buộc/chỉ mục/trigger/extension khớp; 42 yêu cầu HTTP kiểm chứng lịch sử, minh chứng, thông báo, quyền truy cập/thu hồi quyền và ghi tiếp đều đạt. Đây là lượt phục hồi database đầy đủ; lượt kiểm tra D trước đó chỉ khôi phục tệp.

Gói mới có dump 111,843 byte và 2 tệp tổng 75 byte. Chép/kiểm tra kho mất 78 ms; dựng đích và phục hồi mất 4462 ms; toàn lượt 18289 ms. Các số đo chỉ cho dữ liệu giả nhỏ trên máy local, không cam kết thời gian phục hồi hồ sơ thật.

63 test gói/guard đạt, tăng 9 test so với increment trước: tùy chọn hợp lệ/mặc định, thiếu/tương đối/thừa tham số, kho trong repository, thiếu thư mục cha, cấu hình database kế thừa khi chọn kho và kiểm tra trước không ghi vào thư mục mới/có sẵn/không thuộc kho/junction. 22 test đối chiếu kho minh chứng, lint các script đã đổi, build API và kiểm tra format/diff đạt. Không đổi source ứng dụng/schema/giao diện và không chạy lại toàn bộ hồi quy ứng dụng.

Đường dẫn D là tùy chọn truyền khi chạy, không hardcode trong mã và không tự tạo lịch. Cấu hình ghi nhận lựa chọn local nằm ở `run/archive-d-configuration.json` (Git bỏ qua); runner không tự nạp file này. Để các lượt sau dùng D, chạy đúng lệnh có `--archive-root` ở trên. D là cùng ổ chứa mã nguồn, vì vậy chưa có bản sao độc lập khi ổ D hoặc máy hỏng.

## Trước khi dùng dữ liệu thật

Đã có đường dẫn kho cục bộ trên D; trước dữ liệu thật vẫn cần kho trên thiết bị hoặc máy khác, cơ chế xác nhận ổ đích đang sẵn sàng và quyền truy cập, mã hóa và quản lý khóa, lịch/RPO mong muốn, retention do học viện chốt, cảnh báo lỗi và diễn tập trên thiết bị/dung lượng đại diện. Không tự suy ra một thư mục khác trên máy là đã chống mất máy hoặc mất ổ đĩa.

Công cụ chỉ xử lý gói tự khai báo dữ liệu giả trong thư mục drill do người vận hành tin cậy kiểm soát. Cờ/manifest không phân loại được dữ liệu thật và không chống người có quyền sửa cả gói lẫn hash. Chưa có chữ ký manifest, mã hóa, quét mã độc, snapshot production, sync chống mất điện hoặc cơ chế kho bất biến. Giới hạn gói vẫn theo [runbook phục hồi](recovery-rehearsal.md); kho tối đa 10.000 entry. Việc kiểm tra nhiều gói phải đọc đầy đủ byte nên chưa có số đo dung lượng lớn.

Giấy xác nhận sinh viên tiếp tục xử lý trực tiếp tại CTSV. Không thay đổi hoặc công nhận hiệu lực chữ ký/dấu đỏ qua increment sao lưu này.
