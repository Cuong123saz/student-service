# Đọc tệp riêng tư có giới hạn

Ngày 11/10/2026, runtime API thay cách readFile toàn bộ rồi kiểm tra kích thước bằng readPrivateFile. Áp dụng cho minh chứng trong LocalEvidenceStorage, mẫu Word của renderer và PDF do LibreOffice xuất. Không đổi schema, nội dung phiếu, quyền xét hoặc trạng thái chữ ký.

## Cách giới hạn

Trước khi cấp phát, lstat phải nhận tệp thường, có dữ liệu và không quá giới hạn. Sau open, đối chiếu dev/ino/size/mtime/ctime với lstat ban đầu; không chấp nhận file bị đổi hoặc symlink ở tên tệp. Mỗi lần đọc dùng buffer đúng kích thước đã kiểm tra cộng một byte phát hiện tăng dung lượng; không cấp phát từ stat muộn hơn chưa được kiểm tra. Đọc xong đối chiếu số byte, metadata handle và đường dẫn lần nữa, đóng handle kể cả lỗi.

Giới hạn minh chứng là 5 MiB, mẫu Word là 1 MiB, PDF chuyển đổi là 16 MiB. LocalEvidenceStorage.put cũng từ chối dữ liệu rỗng hoặc lớn hơn 5 MiB trước khi ghi; UUID nội bộ và ghi độc quyền wx giữ nguyên. Tệp mới dùng mode0600 và thư mục mới mode0700 trên hệ điều hành hỗ trợ; không sửa quyền thư mục đã có. Các đường dẫn đến từ kho/mẫu/thư mục tạm nội bộ, không nhận tên đường dẫn từ client.

Hàm này kiểm soát dung lượng và thay đổi khi đọc. Service vẫn kiểm tra size/SHA-256 minh chứng với snapshot; template vẫn khóa SHA-256; PDF vẫn phải có header/EOF hợp lệ sau chuyển đổi. Đây không phải quét mã độc, xác minh chữ ký hoặc chứng thực nguồn gốc. Lỗi giữ các mã public FILE_INTEGRITY, DOCUMENT_TEMPLATE_UNAVAILABLE hoặc DOCUMENT_PDF_UNAVAILABLE như trước; không trả path hệ thống hoặc nội dung tệp trong lỗi.

## Kiểm chứng

API đạt 128 unit, 264 integration, 22 storage, 20 fixture, 126 recovery, 6 rào chắn demo và 7 verifier. Một unit tạo symlink bị bỏ qua rõ ràng vì Windows trả EPERM; không ghi là đã kiểm chứng nhánh đó trên máy này. Unit còn lại kiểm tra byte nhị phân ở đúng giới hạn, vượt một byte, tệp rỗng/thiếu/directory và tham số cấp phát không hợp lệ. LocalEvidenceStorage trên đĩa đọc nguyên byte đúng 5 MiB, từ chối key sai, không ghi tệp rỗng/quá cỡ và không đọc tệp kho bị tăng dung lượng.

Build/typecheck/lint và profile CI dùng converter giả đạt. documents:check với LibreOffice thật trả READY: Word143ms, PDF23.032ms trên một lượt; không coi thời gian đó là cam kết tải. Recovery fake e55453d3-e194-4871-8942-0ca023b831cb đạt với database/kho riêng, giữ nguyên toàn bộ snapshot và byte minh chứng sau phục hồi.

Profile dung lượng đã dùng chính LocalEvidenceStorage trong thư mục run/capacity-evidence-* trên ổ D, tự dọn sau phép thử bằng kiểm tra parent/prefix tuyệt đối. Upload, submit và download đi qua hợp đồng HTTP Fastify inject. Bốn PDF mỗi tệp đúng 5 MiB giữ nguyên trên đĩa; hai gói 21.199.076 byte xuất đồng thời trong20.779ms và20.872ms. Yêu cầu vượt mức trả BUNDLE_BUSY trong22ms; 41 probe /services đều200, thời gian lớn nhất28ms và độ trễ timer quan sát lớn nhất52ms. Tệp cùng kích thước bị sửa một byte, rồi tệp bị tăng thành5MiB+1 đều trả FILE_INTEGRITY mà không chuyển đổi thêm.

RSS Node test quan sát từ khoảng281,8MiB lên484,6MiB. Fixture giữ thêm bản mirror trong bộ nhớ để đối chiếu, nên không đồng nhất với bộ nhớ API production. Không gồm LibreOffice con, database hoặc đỉnh tuyệt đối; transport vẫn trong tiến trình, chưa đo TCP/browser cho gói lớn hoặc tải kéo dài. Giữ giới hạn hai tác vụ, không tăng pool/converter từ phép đo này.

Ba gói lớn được đọc độc lập bằng pypdf strict=True: 15PDF một trang có nội dung đọc được, size/hash khớp. Chế độ MemoryStorage trước đó giữ báo cáo riêng để không trộn các kết quả. Log/báo cáo local bị Git bỏ qua: run/private-file-api-final.log, run/private-file-runtime-real.log, run/private-file-recovery-final.log, run/bundle-capacity-20m-concurrent-disk.log, run/private-file-capacity-disk-validation.log, run/capacity-20m-concurrent-report.json và run/private-file-capacity-mock-final.log.


Chromium trên runtime cuối d5bb6e6e-b74c-4d35-ac9e-b5dce8fb2371 đạt luồng sinh viên/cán bộ/quản trị: Word/PDF/ZIP, lịch sử riêng từng round, tải nguyên byte minh chứng, binding đúng,20 kiểm tra độ rộng và0 lỗi JavaScript. DEMO3 chưa sử dụng. Lượt203b trước chỉ chứa ca checker, đã đối chiếu hai lần và sao lưu SQL trước khi dừng; giữ nguyên các runtime3011/3013. Bằng chứng run/private-file-browser-final.log và browser-report.json của lượt mới. Gói mẫu nhỏ mới nhất nằm ở run/output/archives/goi-ho-so-co-phien-ban.zip, có sidecar SHA-256 và đã kiểm tra độc lập; vẫn là bản kê khai chưa ký.

Đã render và xem từng trang Word/PDF của gói mẫu lấy từ runtime cuối: mỗi bản một trang, đầy đủ tiếng Việt/bảng/minh chứng/footer, không cắt nội dung. Ảnh QA nằm tại run/document-qa/bounded-read-final.
