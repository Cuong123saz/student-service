# Kho Word/PDF và điều phối công bố — B2 đang thực hiện

Cập nhật 11/10/2026 theo [ADR0010](adr/0010-document-vault-and-recovery.md). Đã có hạ tầng kho, điều phối và provenance; chỉ chạy qua kiểm thử với dữ liệu giả. Chưa nối vào route hoặc bật trong development/demo. Không ghi nhận phát hành, chữ ký hoặc nghiệm thu Sprint4.

## Luồng đã triển khai

`StoredSubmissionDocumentRenderer` đáp ứng cùng interface xuất phiếu hiện có, nhận registry/vault/renderer Word/converter/provenance qua dependency injection. Chưa thay renderer mặc định của `SubmissionService` và chưa thêm biến môi trường bật tính năng.

Đóng băng snapshot nội bộ, lấy set từ round trong database và kiểm tra binding trước claim. Claim DOCX trước; render Word một lần, kiểm tra gói Word có các phần bắt buộc với giới hạn số phần/dung lượng giải nén, lưu qua staging rồi final, đọc lại size/hash, sau đó mới publish metadata. PDF đọc đúng Word đã công bố, dùng byte đó làm đầu vào converter, kiểm tra lại nguồn sau chuyển, lưu và publish riêng. PDF kế thừa renderer/binding của Word và ghi sourceDocxSha256. Lỗi converter không thu hồi Word. Đây là kiểm tra cấu trúc sơ bộ, không phải quét mã độc hoặc xác thực chữ ký.

READY đọc byte từ kho với size/hash registry; không cần renderer/converter hiện tại và không sinh lại để che tài liệu hỏng. Pair/ZIP chỉ trả khi cả Word/PDF và quan hệ dẫn xuất còn đúng. Service hiện có vẫn kiểm tra quyền trước và sau tác vụ; bài thử mới dùng coordinator thật với repository quyền giả lập để chứng minh bị thu scope trong lúc chuyển thì không trả byte. Chưa coi đó là UAT hoặc thử thu scope trên giao diện đã bật vault.

Sau lỗi publish, coordinator đọc registry để phân biệt COMMIT thành công nhưng mất phản hồi. Chỉ nhận lại row đúng attempt/key/size/hash/template/renderer/converter/source Word. Database không đọc được hoặc không có row khớp thì trả DOCUMENT_PUBLICATION_UNCERTAIN, giữ byte và trạng thái job để đối soát; không chuyển một COMMIT chưa rõ kết quả thành thất bại có thể tạo lại ngay. Tác vụ cũ sau takeover không thể công bố hoặc fail job thay thế.

## Kho tệp

`LocalDocumentVault.create` bắt buộc outputRoot/stagingRoot tuyệt đối, riêng nhau và tách khỏi các protectedRoots (deployment, templates, evidence). Các protectedRoots được phép nằm trong nhau. Kiểm tra lstat/realpath trên từng ancestor để chặn junction/symlink; kiểm tra lại root khi ghi/đọc. Không nhận path hoặc tên tệp từ request, key chỉ là UUID attempt phẳng.

Ghi bản sao buffer của riêng tác vụ, mở wx/mode600, xử lý ghi thiếu và fsync file. Staging được đọc có giới hạn và kiểm tra hash/size trước ghi final bằng wx. Final được đọc lại và đối chiếu trước DB publication. Mỗi định dạng tối đa16MiB, đọc qua helper bounded/N+1/fstat hiện có. Tệp thiếu, khác hash/size, tăng/truncate hoặc root không an toàn trả DOCUMENT_INTEGRITY; không regenerate.

Giữ cả staging và final, kể cả sau thành công, phục vụ bước inventory/reconciliation tiếp theo. Chưa có tác vụ cleanup. Kiểm thử tự xóa duy nhất thư mục tạm do chính bài thử tạo, sau khi kiểm tra absolute parent/prefix; đó không phải cleanup kho đang vận hành. Không tuyên bố chống mất điện từ fsync file: chưa có bằng chứng fsync thư mục hoặc kiểm tra mất điện trên nền tảng này. Kiểm tra đường dẫn không chống được quản trị máy cố ý thay đường dẫn giữa các syscall; kho cần quyền hệ điều hành và deployment bất biến.

## Provenance thật và giới hạn

`LocalDocumentProvenance` thu digest các file JS/CJS/MJS/JSON trong codeRoots đã cấu hình (bản compiled API và dependency fflate được cài), cùng package-lock/package metadata. Digest có tên tương đối/size/byte, không chứa đường dẫn máy trong metadata công bố. Có giới hạn file/thư mục/tổng byte, từ chối junction/symlink. Trước/sau render kiểm tra lại manifest ban đầu để không gán code đã sửa trên đĩa cho module đã nạp. Ghi Node/ICU thực tế. Cần khởi tạo từ deployment bất biến; đây không phải chứng thực chuỗi cung ứng hoặc hash toàn bộ hệ điều hành/Node binary.

Converter ghi phiên bản thực từ `--version` và SHA-256 của soffice.bin thực tế, kiểm tra launcher và binary trước/sau; thay đổi launcher/binary giữa các lần dùng bị từ chối. Word không phụ thuộc converter sẵn sàng. Không coi digest soffice.bin là digest toàn bộ thư viện/font/config của LibreOffice, hoặc cam kết tái tạo PDF giống byte ở máy khác. Tính bất biến được chứng minh bằng lưu/đọc cùng byte.

## Kiểm chứng và bằng chứng

15 unit riêng cho vault/provenance đạt: binary nguyên byte, đúng16MiB/vượt giới hạn, đầu vào bị caller sửa, wx không ghi đè, key/digest không hợp lệ, root lồng/relative, junction ở root/ancestor và bị thay sau khởi tạo, tệp bị sửa/tăng/truncate/xóa/thành directory, lỗi sau staging/final giữ dấu vết, build/dependency/lockfile đổi và converter thiếu không chặn Word.

Registry integration dùng database tạm document_registry_test_<UUID> trên5434, không reset development hoặc demo. Ngoài rào chắn SQL cũ, thử lưu Word thật/PDF giả rõ ràng, đọc lại qua instance mới không gọi renderer/converter, lỗi PDF giữ Word, nguồn hỏng trước/trong chuyển, mất phản hồi publish, DB không đọc được sau lỗi commit, claim đồng thời, worker tiếp tục sau lease takeover, kiểm tra quyền trước/sau và từ chối output sai cấu trúc.

Fault worker Node riêng chỉ nhận database có prefix test/host/port đã khóa. Ba bài thử dừng đúng child do bài thử tạo ở STAGED (chưa có final), FINAL (chưa có registry), COMMITTED (trước phản hồi ứng dụng). Giữ artifact, đợi lease rồi claim token mới ở hai trường hợp đầu; trường hợp cuối đọc đúng file đã công bố và không render lại. Ở STAGED có process thứ hai tranh cùng set và nhận BUSY. Đây là process death thật và hai process SQL; không phải kill tiến trình LibreOffice đang chạy, lỗi nguồn điện hoặc mất HTTP response trên TCP. Lỗi phản hồi COMMIT còn có bài thử facade riêng.

Lượt converter thật dùng module compiled, provenance compiled API + fflate + lock/package, LibreOffice thực và lease180 giây. Lượt đầu dùng lease10 giây của bài thử SQL bị từ chối đúng rào chắn; không nới ràng buộc SQL. Lượt chạy với cấu hình thực đạt, Word/PDF lưu riêng và tải lại cùng byte. PDF được kiểm tra độc lập bằng pypdf strict; tất cả trang Word render và PDF thực đã xem, một trang, tiếng Việt rõ, footer chưa ký, không cắt chữ. Bộ kiểm tra này chưa đo tải TCP hoặc tổng bộ nhớ máy.

Bằng chứng Git bỏ qua: run/document-vault-unit-first.log, run/document-vault-real-final-confirmed.log, run/document-vault-api-regression.log, run/document-vault-typecheck-final.log, run/document-vault-lint-final.log, run/document-vault-build-final.log; artifact run/vault-real-word.docx, run/vault-real-pdf.pdf và run/vault-real-provenance.json. Log lỗi đầu được giữ riêng, không coi là lượt đạt. Hồi quy API hoàn tất: 143 unit đạt, một unit symlink cũ bỏ qua do Windows EPERM; 292 integration, 22 storage, 20 fixture, 170 recovery/archive/encryption, 6 demo guard và7 bundle verifier đạt. Lượt riêng có converter thật đạt29 test (28 tình huống và test cha). Typecheck/lint/build và format đạt. Development registry vẫn chưa có, migration count vẫn24; trang3011/3013/3015 trả200 qua kiểm tra chỉ đọc. Không chạy lại checker đã tiêu thụ dữ liệu hoặc sửa dữ liệu thực hành.

## Điều kiện còn thiếu trước khi bật

Audit inventory và backup/restore registry thật đã có qua [diễn tập B2](registry-recovery.md), giữ stage đã đối soát và từ chối orphan. Đã thu lease RUNNING trước API mới và thử chạy tiếp PDF từ Word cũ. Guard v1/fixture-v2 vẫn từ chối registry có hàng; chỉ chế độ DATABASE_REGISTRY riêng mới dùng snapshot đủ kho. v1 không đủ phục hồi hệ thống đã bật vault.

Cần đường retry vận hành có audit sau khi khắc phục nguyên nhân, vì job hiện dừng sau3 attempt và không cho reset tùy ý. Route owner/reviewer/admin và ZIP cùng byte đã đạt sau restore trên API rehearsal riêng. Cần kiểm chứng kill/supervisor của converter, rồi mới demo riêng và nâng development có backup/đối chiếu. Không migrate/stop các demo3011/3013/3015 đang thực hành. B3 đo TCP/nhiều worker, backup ngoài thiết bị nguồn, UAT và mock signer vẫn chưa hoàn thành.
