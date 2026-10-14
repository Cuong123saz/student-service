# Giám sát bộ chuyển PDF trên Windows

Cập nhật 11/10/2026. Áp dụng vào renderer hiện có và coordinator có kho; chưa bật vault mặc định ở development hoặc thay dữ liệu thực hành cũ. Đầu ra vẫn là phiếu kê khai chưa ký.

## Cơ chế

Mỗi lần gọi LibreOffice dùng một PowerShell host riêng và Windows Job Object riêng. Gắn job ngay trong CreateProcess bằng PROC_THREAD_ATTRIBUTE_JOB_LIST, bật KILL_ON_JOB_CLOSE, không cho breakaway. Tránh khoảng trống tạo process rồi mới gắn job. Process con do LibreOffice tạo nằm trong cùng job; handle job không truyền cho converter. Cơ sở API: [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) và [thuộc tính tạo process](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute). Cần Windows10/Server2016 trở lên; API không hỗ trợ thì từ chối tạo PDF, không chạy đường dự phòng không giám sát.

API giữ pipe tới host. Hết hạn hoặc API biến mất làm host hủy job; host bị tắt thì hệ điều hành đóng handle và thu process trong job. Host chỉ báo empty sau khi QueryInformationJobObject xác nhận ActiveProcesses bằng0. Root thoát nhưng con còn chạy sau khoảng chờ500ms bị từ chối và thu hồi. Đây là xác nhận thu hồi process trên Windows đang kiểm thử, không phải cam kết thời gian tắt tuyệt đối trên mọi máy.

Thời hạn tạo PDF90 giây tính từ trước khi khởi động host; quá hạn không tạo converter mới. Sau yêu cầu hủy, API cho host tối đa10 giây để thu hồi và báo kết quả rồi mới tắt đúng host mình sở hữu. Nếu mất kết quả hoặc không xác nhận được job rỗng, module bị cách ly đến khi ứng dụng được khởi động lại sau kiểm tra. Converter giữ working directory và slot nghi ngờ, không tự dọn dấu vết hoặc tự mở lại. Không quét/tắt mọi tiến trình LibreOffice/Node trên máy.

Đọc phiên bản --version cũng đi qua cùng host/job, ngân sách10 giây trên Windows gồm khởi động PowerShell và Add-Type. Phiên bản có giới hạn4096 byte cho stdout/stderr gộp, giao thức host tối đa8192 byte; quá giới hạn hoặc exit khác0 bị từ chối. Converter không đọc stdin của API: chỉ nhận NUL và pipe đầu ra qua danh sách handle thừa kế tường minh. Không gọi shell với câu lệnh LibreOffice; đường dẫn executable tuyệt đối và đối số được quote theo quy tắc Windows CRT.

Bản build sao chép script ps1 vào dist. Provenance đưa ps1 cùng JS/CJS/MJS/JSON và metadata vào digest, kiểm tra lại trước/sau render và trước/sau bước đọc phiên bản. PDF chạy tiếp từ Word cũ vẫn phải dùng deployment hiện tại bất biến; PDF đã READY có thể tải lại từ kho mà không cần chạy converter. Không coi digest này là chứng thực toàn bộ PowerShell/Node/OS/font/thư viện LibreOffice.

## Kiểm chứng

16 bài thử supervisor đạt, gồm timeout có process con detached, root thoát để con chạy, tắt API cha hoặc host ở cả chế độ có/không capture output, từ chối deadline đã hết, quote Unicode/nháy/backslash, đúng4096 byte/vượt giới hạn, lỗi exit và cách ly sau mất kết quả. Ba bài dùng LibreOffice thật: đọc phiên bản và quan sát soffice.bin biến mất sau API/host chết trong profile riêng. Kiểm tra PID không còn hoạt động, không chỉ xác nhận lời gọi kill thành công.

Compiled runtime + kho + LibreOffice thật đạt38/38 bài. Diễn tập mã hóa `a9f57c69-e85e-4767-9f23-e20b54c6a47e` PASS, cleanup process/container=true, 106.51 giây, 30 bảng/4 sequence. Khôi phục lịch sử retry, thu lease, cấp lượt đúng quyền/audit rồi tạo PDF lần5 từ cùng Word cũ. Word/PDF tải lại nguyên byte. PDF mẫu mới đọc pypdf strict và đã xem toàn bộ trang, tiếng Việt và footer chưa ký rõ.

Hồi quy158 unit đạt/1 skip Windows EPERM cũ,306 integration đạt,5 provenance đạt; typecheck/lint/build/format đạt. Log: run/document-supervisor-real-final.log, run/document-supervisor-unit-final.log, run/document-supervisor-integration-final.log, run/document-supervisor-real-vault-final.log và run/document-supervisor-real-recovery-final.log. Không commit log, vault hoặc khóa.

Lượt capture với ngân sách phiên bản5 giây đã FAILED vì gồm thời gian khởi động host/biên dịch C# và gọi LibreOffice; giữ run/document-supervisor-real-vault-capture-timeout-failed.log cùng probe lỗi. Sửa ngân sách riêng Windows thành10 giây, không nới90 giây chuyển PDF hoặc bỏ rào chắn. Chạy lại38 bài với converter thật và toàn bộ diễn tập mã hóa đạt. Các lượt lỗi ban đầu không được tính là bằng chứng đạt.

## Giới hạn còn lại

Linux/POSIX hiện dùng process group để thu khi hết hạn; chưa chứng minh thu hồi khi API cha chết tương đương Windows. Chưa đưa ra cam kết vận hành Linux. Quota2 job qua lease DB là điều phối hợp tác giữa các instance; không phải giới hạn tổng CPU/RAM hoặc bằng chứng không thể vượt quá hai process trên mọi host trong mọi lỗi. Cần đo TCP/nhiều worker/gói lớn và tổng bộ nhớ máy theo B3. Chưa có kiểm tra mất điện, backup trên thiết bị khác hoặc nghiệm thu người dùng.

## Chẩn đoán hữu hạn ngày12/10

Observer nội bộ nhận outcome EXITED/FAILED/TIMEOUT/UNCERTAIN/UNAVAILABLE, nativeReason hữu hạn, started/empty, watchdogExpired, elapsedMs và startupMs. startupMs tính từ đầu lời gọi tới STARTED; elapsedMs tới lúc host đóng. watchdogExpired chỉ là timer phía Node đã kích hoạt, không thay nativeReason hoặc đồng hồ deadline của host. Không chứa command, đối số, PID, đường dẫn, output hoặc driver log. Lỗi logger/observer không được biến một lượt chuyển thành lỗi hoặc mở lại năng lực đang cách ly; trạng thái UNCERTAIN được khóa trước khi phát chẩn đoán.

LocalDocumentProvenance nhận observer qua tham số nội bộ riêng, không đưa hàm vào cấu hình/digest và không đổi metadata công bố. Demo mới tạo sau thay đổi ghi rõ phase VERSION hoặc PDF. Demo12d8bed0 đang thực hành vẫn dùng runtime đã sao chép trước đó, không sửa deployment đang chạy chỉ để có log mới.

Công cụ npm run documents:process-check --workspace @student-service/api chạy ba lần đọc phiên bản, không DB và không nhận command từ đối số. Yêu cầu --fake-data-only, Windows và LIBREOFFICE_PATH tuyệt đối; từ chối môi trường có DATABASE_URL/SUBMISSION_STORAGE_ROOT hoặc APP_ENV production. Mỗi lần giữ ngân sách10 giây và cùng rào chắn thu hồi; nếu chưa xác nhận job rỗng thì dừng mẫu tiếp theo. Không dùng probe để reset job/retry hoặc kết luận ký số hợp lệ.

Lượt probe đạt3/3, startup847/899/926ms, tổng7092/7051/7046ms; version digest giống nhau và job rỗng, watchdog không kích hoạt. Đây là các host/process mới trong phiên máy hiện tại, không phải thử khởi động nguội toàn máy hoặc tái hiện lỗi PDF lần trước. Chưa đủ bằng chứng kết luận nguyên nhân hoặc nới thời hạn. Log run/document-process-diagnostics-probe.log.

22 bài chuyên biệt (17 supervisor có LibreOffice thật +5 provenance) đạt. Sau đổi tên chỉ số thành watchdogExpired, ba bài timeout/report chạy lại đạt, gồm callback ném lỗi không gây cách ly sai và output riêng tư không nằm trong report. Typecheck/build/lint đạt. Không thay schema hoặc route HTTP; không dùng số kiểm thử này để thay306 integration của mốc trước hoặc nghiệm thu giao diện mở lượt.

Bốn bài thu hồi/cách ly chạy lại sau đặt khóa UNCERTAIN trước observer đều đạt, gồm tắt host lúc LibreOffice thật đang chạy. Demo hiện tại vẫn trả HTTP200. Bằng chứng bổ sung: run/document-process-diagnostics-quarantine-tests.log; bộ chẩn đoán không sửa dữ liệu hồ sơ hoặc bật retry ở development.

## Điều chỉnh VERSION theo số đo ngày13/10

Ngân sách hiện tại trên Windows: VERSION15 giây, PDF90 giây; Linux VERSION vẫn5 giây. Thay riêng10→15 sau khi đo được first VERSION timeout tại preflight12,334 giây tổng thu process, và probe10 giây ghi nhận native EXITED ở10,129 giây nhưng Node watchdog đã hết hạn; cả hai empty=true. Không đổi giới hạn output4KiB, native job termination, quarantine hoặc lease. Ba probe với15 giây đạt khoảng6,3–6,5 giây; đây là lần khởi động process, không phải phép đo cold boot máy.

Bài provenance mới dùng executable giả của riêng fixture, trả phiên bản sau11 giây: đọc thành công, outcome EXITED/empty=true/watchdogExpired=false. Cùng5 test trước thành6 đạt; fake executable được dọn theo guard thư mục tạm. Readiness và toàn luồng backend thật của [demo workspace](workspace-vault-demo.md) đạt. Đây là bằng chứng sửa một đường timeout VERSION đã quan sát, không chứng minh nguyên nhân cuối của lỗi PDF đầu ngày12/10 hoặc bảo đảm mọi lần chuyển sẽ thành công.


## Sửa báo timeout trong giai đoạn đóng supervisor ngày 14/10/2026

Lượt hồi quy ký mô phỏng tái hiện version reader trả nativeReason EXITED, job empty, nhưng watchdog Node hết hạn trong lúc PowerShell đóng lại: elapsed15.713s/startup2.206s với converter giả ngủ11s. Probe LibreOffice thật có lượt14.719s và17.003s, native EXITED; không coi mọi timeout là converter bị treo.

Sau thông điệp RESULT hợp lệ, dừng timer chuyển đổi và bắt đầu hạn thu hồi owner riêng10s. Vẫn chờ close trước trả thành công. Owner không đóng thì kill/quarantine như trước; RESULT thiếu/không hợp lệ hoặc job không rỗng không được chấp nhận. Sau khi sửa phân biệt hai giai đoạn, lượt khởi động mới vẫn có native TIMEOUT/empty ở15s: đây là vượt hạn thật, không phải lỗi đóng owner. Ba probe với hạn30s đo14.719s,17.003s và31.001s gồm đóng owner (lượt cuối native EXITED trước đóng, watchdog cũ vẫn báo timeout). Vì vậy ngân sách VERSION được hiệu chỉnh15→30s để bao phủ cold start đã đo; PDF giữ90s và owner cleanup10s. Hạn vẫn hữu hạn, không retry vô hạn hoặc bỏ kiểm tra thu hồi. Cần lượt rehearsal mới đạt trước khi kết luận môi trường sẵn sàng.


Hồi quy unit mặc định chạy nhiều file đồng thời trên Windows đã làm fixture process bị thu hồi trước khi kịp tạo info file (OWNED_FIXTURE_NOT_STARTED). Unit launcher trên Windows chạy file tuần tự, như integration đã làm; không tăng hạn của fixture hoặc bỏ bài. Đây là kiểm soát tài nguyên của bộ kiểm thử, không đổi concurrency của API/converter khi phục vụ request.


Chẩn đoán PDF14/10: readiness và probe độc lập đều WORD_ONLY do conversion vượt90s, job được thu hồi empty=true. Native probe giữ profile riêng trong project, chưa sinh PDF và chưa có stdout chuyển đổi. Đã đối chiếu [tham số LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html); không thêm nofirststartwizard vì tài liệu ghi cờ này bị bỏ qua. Giả thuyết tiếp theo là khởi tạo đồ họa của headless Windows; thử SAL_DISABLESKIA/SAL_DISABLEGL trong probe riêng theo [biến VCL chính thức](https://raw.githubusercontent.com/LibreOffice/core/master/vcl/README.vars.md), chưa kết luận nguyên nhân hoặc bật mặc định khi chưa có kết quả.


Lượt unit tuần tự còn phát hiện rào chờ info file7s ngắn hơn hạn process10/30s của các ca khác. Tăng riêng thời gian quan sát info file lên20s; giữ nguyên hạn kill6s và điều kiện cây process phải hết. Không bỏ assertion hoặc coi fixture chưa khởi tạo là đạt.


## Kết quả đối chiếu cuối ngày 14/10/2026

Probe tắtSkia/OpenGL vẫn timeout, không bật những cờ này mặc định. Cảnh báo Python còn ở lượt chuyển thành công nên chưa xác định là nguyên nhân. Profile đã khởi tạo có lượt51.53s/EXITED/empty=true; bootstrap mới bằng Word đã điền dữ liệu giả đạt80.462s lần1. Manifest135 file gồm cache rỗng và tên literal%2F; không URL-decode tên file. Các lỗi validator trước đã được giữ trong log rồi sửa bằng test tương ứng.

Theo [ADR0015](adr/0015-synthetic-converter-profile.md), riêng rehearsal mock-signature dùng seed đã khóa hash/binary và chép vào profile tạm của từng request. Readiness PDF đạt53.302s; workflow19 nhóm/24 responsive và mock7 nhóm/4 tệp/12 audit riêng đạt, không sửa nguồn. WordQA dùng renderer được cung cấp với seed đã kiểm hash, đường dẫn namespace Windows cho cache dài và thư mục tạm ngắn trong project; hai lần57.054s/36.364s EXITED/empty=true. Đã xem đủ4 trang Word/PDF. Đây là bằng chứng môi trường giả có cấu hình được chuẩn bị, không cam kết cold profile mặc định hoặc production.
