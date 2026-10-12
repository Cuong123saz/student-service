# Dọn tệp thử ngoài dự án theo yêu cầu chủ dự án

Ngày12/10/2026 đã xóa17 thư mục,272 file,18434115 byte ngoài D:/student-service: các archive phục hồi giả thường/mã hóa, hai thư mục khóa thử, bảy kho registry drill và bốn kho vault demo đã dừng. Đối chiếu marker fakeDataOnly, báo cáo UUID và trạng thái; kiểm tra absolute path/allowlist, mọi entry không là junction/symlink trước Remove-Item. Không sao chép lại payload hoặc khóa trước xóa.

Giữ D:/student-service, dự án cũ D:/student-service-api và D:/student-service-vault-demo-12d8bed0-c37b-4ced-b1bc-3559550c1a3c để không xóa kho của bản demo chủ dự án đang mở. Mẫu DOCX trong Downloads và tài liệu người dùng chưa được Git theo dõi không thay đổi. Biên bản tên đường dẫn/số file/dung lượng, không chứa khóa hoặc nội dung hồ sơ: run/external-artifact-cleanup-20261012.json (Git bỏ qua).

Các bằng chứng test trong run và tài liệu Git là lịch sử kiểm chứng. **Archive và khóa thử ngoài dự án đã xóa không còn dùng để phục hồi**; những đường dẫn cũ trong tài liệu recovery là lịch sử, không phải bản sao đang tồn tại. Bản sao development mới nằm trong run/offline-development trong dự án, xem [quy trình riêng](offline-development-preservation.md).

Trong lúc tiếp tục, Docker đã dừng; sau mở lại engine, container database của demo12d8 vẫn exited dù trang login còn HTTP200. Chưa tự khởi tạo/start lại database tmpfs đó hoặc tuyên bố dữ liệu demo còn truy cập được. Kho và các bản chốt trong project được giữ để đối soát trước khi dựng một demo mới.
