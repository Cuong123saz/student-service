# Theo dõi và mở thêm lượt tạo tài liệu

ADR0011 đã Accepted và commit `70d9f29` trước migration0024. Chỉ dữ liệu giả; chưa bật renderer có kho hoặc thao tác mở lượt trong development và các demo cũ.

## Hành vi

Word được công bố trước, PDF tiếp tục dùng đúng byte Word. Lỗi PDF không thay hồ sơ hoặc bắt sinh viên gửi lại. Ba lần thử ban đầu; người được cấp quyền có thể mở thêm đúng một lượt sau khi khắc phục nguyên nhân, tối đa ba lần bổ sung, tổng tối đa sáu lần. `attempts` chỉ tăng; không reset hoặc xóa lịch sử. Đọc trạng thái không tạo set/job, không gọi converter và không tiêu tốn lượt.

GET `/:portal/{submissions|review-submissions}/:id/rounds/:roundNumber/document-status` (dưới `/api/v1`) trả trạng thái Word/PDF, số lần, giới hạn, mã lỗi hữu hạn và khả năng mở lượt. Owner qua quyền sở hữu; cán bộ qua quyền/phạm vi/đơn vị/phân công hiện tại. Không trả storage key, đường dẫn hoặc log bộ chuyển PDF. Môi trường chưa bật trả `enabled:false`.

POST `/:portal/review-submissions/:id/rounds/:roundNumber/documents/:format/retry` chỉ ở cổng reviewer user/admin, format `docx|pdf`. Body đúng ba trường UUID `requestId`, UUID `expectedAttemptId`, và `reasonCode`: RENDERER_FIXED, CONVERTER_FIXED, STORAGE_FIXED hoặc WORKER_RESTARTED, phải tương ứng lỗi hiện tại. Bắt buộc phiên đúng cổng, đúng origin và giới hạn ba yêu cầu/phút. Owner không có endpoint ghi.

Quyền `document.retry` và `submission.review` cùng vai trò được gán, cùng scope hiện tại. Mặc định mới chỉ SYSTEM_ADMIN có `document.retry`; vẫn cần scope được gán. ADMIN hoặc DOCUMENT_SIGNER không tự có quyền. Người có quyền xem hồ sơ không đương nhiên được mở lượt; không xử lý hồ sơ chính mình. Kiểm tra quyền lại sau khi chờ khóa, trước cả replay; trigger cũng kiểm tra quyền từ DB tại lúc ghi.

Migration0024 thêm job `retry_allowance` và bảng append-only `submission_document_retries`. Khóa set rồi job; insert quyết định, tăng allowance và audit USER `document.retry.authorized` trong cùng transaction. Một attempt chỉ có một quyết định. Cùng request UUID/nội dung trả kết quả cũ; nội dung khác, token cũ, job còn đang chạy, COMPLETE hoặc đã đủ sáu lần bị từ chối. Audit lỗi rollback toàn bộ, kể cả thu lease RUNNING đã hết hạn. Mở lượt không đổi token/attempts; claim kế tiếp mới sinh token và tăng số lần, sau ba giây và qua quota hiện có. Tác vụ cũ vẫn không công bố được.

Giao diện có nút kiểm tra tình trạng, nguyên nhân dễ hiểu và checkbox xác nhận đã khắc phục trước khi mở một lượt. Không tự chọn checkbox. UUID thao tác được giữ nếu mất phản hồi để gửi lại không mở hai lượt. Đây là xác nhận của người vận hành; phần mềm không tự chứng minh người đó đã sửa nguyên nhân.

## Phục hồi và bằng chứng

Inventory nhận biết schema0023/0024 từ DB, giữ projection/digest cũ khi chưa có allowance, đưa quyết định retry vào snapshot mới và kiểm tra số lượt cộng dồn cùng lịch sử liên tục. Không chấp nhận vượt ba lần khi thiếu quyết định tương ứng. Manifest/archive/encryption v2 không đổi cấu trúc; digest registry bao gồm bảng quyết định trong dump. Giữ hỗ trợ v1 và fixture v2 cũ.

Diễn tập mã hóa thật `f741a234-6dc1-4d3c-819f-51f8c3a182eb` PASS, cleanup process/container true, 113.77 giây, 30 bảng/4 sequence. Ba tài liệu + ba stage + một mẫu và một quyết định mở lượt tại backup. Cố tình hết ba lượt PDF, mở lượt thứ4 có audit rồi để RUNNING; loại cluster nguồn, khôi phục sang cluster mới, so sánh toàn bộ rows/schema/index/constraint/trigger/sequence và registry digest trước chuẩn bị lease. Sau thu lease, PDF vẫn hết lượt4/4, owner không mở được; cán bộ cấp thêm một lượt có audit và replay không tăng lượt; lần5 tạo PDF thật từ nguyên Word cũ. Hai quyết định cuối, Word giữ nguyên; 77 HTTP request gồm các từ chối chủ động (52x200, 1x401, 3x403, 12x404, 7x422, 2x503). Không coi đây là thử tải TCP hoặc nghiệm thu.

Bằng chứng trong `run/document-retry-real-recovery-final.log` và `run/recovery-drills/f741a234-6dc1-4d3c-819f-51f8c3a182eb/report.json`; archive mã hóa và vault giả giữ riêng ở ổ D, khóa giữ riêng, không commit. Lượt `5d6f6dc9-e2d5-41b5-b419-66ba210c2486` đã từ chối khi PostgreSQL deparse thêm một lớp ngoặc do BETWEEN; sửa khai báo constraint thành >=/<= tương đương, không nới bộ đối chiếu và đã chạy lại toàn bộ diễn tập đạt. Migration và snapshot không drift.

Hồi quy: 144 unit đạt/1 skip Windows EPERM cũ, 306 integration đạt (gồm migration giữ nguyên tài liệu/job/audit, permission, token fence, hai người cạnh tranh, idempotency, thu hồi quyền lúc chờ khóa, rollback audit và trần sáu lần), 122 web đạt; 213 recovery/archive/encryption +20 fixture +6 demo guard; 44 ADR gate đạt. Typecheck/lint/build/format và schema generation đạt. Kiểm tra hiển thị bằng Chromium riêng, API giả ở 375/1440px: không tràn ngang, không lỗi JS, checkbox bàn phím và thao tác mở lượt đạt; đã xem cả hai ảnh. Đây là kiểm tra bố cục, không thay UAT trên backend thật.

Supervisor Windows và converter thật đã được kiểm chứng, gồm --version; xem [bằng chứng thu hồi process](document-process-supervisor.md). Diễn tập mã hóa mới a9f57c69-e85e-4767-9f23-e20b54c6a47e đạt với supervisor. Tiếp theo: demo vault mới với backend thật, runtime/ports riêng; backup/đối chiếu trước khi nâng development. Chưa tự reset dữ liệu hoặc migrate các demo 3011/3013/3015. Chưa hoàn tất B2/B3 hay ký/phát hành thật.

Demo kho riêng đã có kiểm chứng tải/tải lại và UI trạng thái với backend thật; xem [demo vault](vault-demo.md). UI mở thêm lượt khi hết số lần vẫn cần kiểm chứng riêng trên backend thật, không suy ra từ bài bố cục/API giả hoặc trạng thái READY. Development/demo cũ chưa bật retry.

Diễn tập giao diện trên backend thật ngày12/10 đã đạt với bộ chuyển PDF thật: ba lỗi có kiểm soát, quyền/phạm vi, checkbox, audit,429/Retry-After và replay, PDF lần4 giữ Word gốc. Chi tiết và giới hạn: [retry browser rehearsal](retry-browser-rehearsal.md). Demo phát triển mặc định chưa được nâng theo mốc này.
