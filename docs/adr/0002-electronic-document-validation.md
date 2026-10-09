---
status: Accepted
date: 2026-10-09
decisionOwner: Project owner
approvedBy: Project owner via conversation
approvedAt: 2026-10-09
---

# ADR 0002 Xác minh chữ ký và chấp nhận hồ sơ điện tử

Chủ dự án chấp nhận đề xuất tách kết quả xác minh chữ ký khỏi quyết định chấp nhận hồ sơ trong hội thoại ngày 09/10/2026. Đây là quyết định thiết kế của dự án cá nhân, không phải quy chế ban hành văn bản hoặc xác nhận thẩm quyền ký của Học viện Quản lý Giáo dục.

## Quyết định

Hệ thống phải lưu riêng kết quả xác minh kỹ thuật của từng chữ ký trên từng phiên bản tài liệu và kết quả xét hồ sơ của cán bộ. Chữ ký hợp lệ không tự động làm hồ sơ được chấp nhận; quyết định chấp nhận hồ sơ không biến bản scan hoặc ảnh dấu thành tài liệu đã được xác minh chữ ký số.

Ảnh chữ ký và dấu đỏ là thông tin hiển thị. Không dùng việc nhận diện được hình ảnh đó để kết luận chữ ký số hợp lệ, tài liệu là bản gốc hoặc người ký có thẩm quyền. Bản scan có thể được tiếp nhận làm minh chứng theo quy định của từng thủ tục; phải ghi nhận yêu cầu đối chiếu hoặc xác thực nguồn khi áp dụng.

## Kết quả xác minh kỹ thuật

Các trạng thái nghiệp vụ cần phân biệt khi xây dựng chức năng xác minh:

| Kết quả                   | Ý nghĩa                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Chưa xác minh             | Chưa chạy kiểm tra trên phiên bản tài liệu này                                                                           |
| Không phát hiện chữ ký số | Không tìm thấy chữ ký số trong định dạng được hỗ trợ; không kết luận hồ sơ giả hoặc vô hiệu                              |
| Chữ ký số hợp lệ          | Đạt các kiểm tra kỹ thuật theo chính sách tin cậy áp dụng                                                                |
| Chữ ký số không hợp lệ    | Có bằng chứng kiểm tra không đạt, kèm lý do cụ thể                                                                       |
| Chưa đủ căn cứ xác minh   | Thiếu dữ liệu, chưa tin cậy chuỗi chứng thư, định dạng chưa hỗ trợ hoặc không truy vấn được trạng thái; không gán hợp lệ |

Không coi lỗi mạng, lỗi dịch vụ xác minh hoặc định dạng chưa hỗ trợ là bằng chứng chữ ký không hợp lệ. Không coi không phát hiện chữ ký số là lỗi đối với minh chứng mà thủ tục cho phép nộp bản scan. Việc kết luận không có chữ ký chỉ được thực hiện sau khi bộ đọc hỗ trợ định dạng đã phân tích thành công.

Các kiểm tra gồm danh tính chủ thể ký; tính đúng của chữ ký mật mã; tính toàn vẹn và phạm vi nội dung được ký; chuỗi chứng thư và nguồn tin cậy phù hợp pháp luật; phạm vi sử dụng chứng thư; thời hạn và trạng thái tạm dừng/thu hồi tại thời điểm ký qua OCSP/CRL hoặc bằng chứng xác minh phù hợp.

Đánh giá thay đổi sau khi ký theo từng chữ ký và phiên bản, kể cả tài liệu có nhiều người ký. Không tự coi mọi lần bổ sung chữ ký hoặc dữ liệu xác minh hợp lệ là sửa nội dung trái phép. Không suy ra thời điểm ký chỉ từ dòng ngày tháng được in trên văn bản; dùng bằng chứng thời gian đáng tin cậy và dấu thời gian khi cần chứng minh thời điểm ký. Chứng thư hết hạn tại thời điểm kiểm tra không tự động làm chữ ký đã tạo trước đó không hợp lệ.

Giữ nguyên file nhận được, mã băm, chứng thư và bằng chứng trạng thái/thời gian cần thiết để kiểm chứng lại. Bản xem trước hoặc bản chuyển đổi định dạng không ghi đè file đã ký. Ghi nhận thời điểm kiểm tra, phiên bản bộ xác minh/chính sách tin cậy, kết quả và lý do; không lưu khóa bí mật, PIN, token nhà cung cấp hoặc nội dung nhạy cảm không cần thiết trong log.

## Quyết định chấp nhận hồ sơ

Cán bộ xét riêng nội dung, người nộp, sự phù hợp của minh chứng, điều kiện thủ tục, thời hạn sử dụng tài liệu nếu có và thẩm quyền ban hành/ký. Các kết quả xét gồm chưa xét, chờ bổ sung/đối chiếu, chấp nhận và từ chối; lưu người quyết định, thời gian, lý do và phiên bản hồ sơ được xét.

Quyền xét hồ sơ, quyền ký văn bản và quyền sử dụng chữ ký của tổ chức là các quyền riêng. Quyền ADMIN hoặc submission.review trong ứng dụng không chứng minh thẩm quyền pháp lý để ký giấy xác nhận. Việc ký thay hoặc theo ủy quyền phải có căn cứ và còn hiệu lực đối với loại văn bản đó.

Nếu thủ tục bắt buộc tài liệu có chữ ký số, trạng thái thiếu chữ ký, chưa xác minh, không hợp lệ hoặc chưa đủ căn cứ không đáp ứng yêu cầu đó; cần bổ sung hoặc xử lý theo quy trình được phê duyệt. Cán bộ không được chuyển kết quả kỹ thuật thành hợp lệ chỉ bằng nút chấp nhận. Với thủ tục cho phép bản scan, kết quả đối chiếu nguồn/bản giấy được ghi nhận riêng.

## Giấy xác nhận sinh viên và phạm vi hiện tại

STUDENT_CONFIRMATION tiếp tục OFFLINE tại Phòng CTSV theo ADR 0001. Phòng tiếp nhận không mặc nhiên là đơn vị hoặc cá nhân có quyền ký ban hành. Bản Word có dữ liệu giả định trong hội thoại chỉ là mẫu minh họa.

Trước khi phát hành điện tử phải có quy định của Học viện về mẫu chính thức, người có thẩm quyền và cơ chế ủy quyền, đơn vị ban hành, loại chữ ký/chứng thư áp dụng, các chữ ký bắt buộc, quy trình phát hành và điều kiện tiếp nhận bản scan/bản chuyển đổi. Với văn bản thuộc Nghị định 30/2020/NĐ-CP, áp dụng yêu cầu tại Điều 5 về chữ ký số của người có thẩm quyền và của cơ quan, tổ chức.

Increment hiện tại chỉ có cấu hình biểu mẫu và yêu cầu minh chứng. ADR này ghi nhận nguyên tắc cho bước thiết kế tiếp theo; chưa bổ sung chức năng upload, xét hồ sơ, ký hoặc xác minh chữ ký số và chưa chọn nhà cung cấp chứng thực. Việc chấp nhận nguyên tắc này không thay cho nghiệm thu đóng Sprint 4.

## Điều kiện kiểm chứng khi triển khai

- Ảnh dấu/chữ ký và bản scan không được gán chữ ký số hợp lệ; vẫn cho phép xét minh chứng theo chính sách thủ tục.
- Tài liệu ký đúng và chứng thư phù hợp được xác minh; nội dung sai nghiệp vụ vẫn có thể bị từ chối.
- Sửa nội dung được bảo vệ hoặc ký bằng chứng thư bị thu hồi tại thời điểm ký phải có kết quả/lý do không đạt; phân biệt sửa trái phép với bổ sung chữ ký được phép.
- Chứng thư hiện đã hết hạn nhưng có đủ bằng chứng hợp lệ tại thời điểm ký phải được đánh giá theo thời điểm ký.
- Lỗi OCSP/CRL, nguồn tin cậy chưa xác định và định dạng chưa hỗ trợ phải hiện chưa đủ căn cứ, không tự chấp nhận.
- Người có chữ ký kỹ thuật hợp lệ nhưng thiếu thẩm quyền, thiếu chữ ký tổ chức bắt buộc hoặc thiếu minh chứng phải không vượt điều kiện xét/phát hành.
- Xác minh lại phiên bản cũ và phiên bản mới không ghi đè lịch sử kết quả hoặc file gốc; phân quyền và lịch sử quyết định phải kiểm chứng được.

## Căn cứ đối chiếu ngày 09/10/2026

Các nguồn dưới đây là cơ sở đối chiếu cho thiết kế; phải kiểm tra lại văn bản và quy chế áp dụng trước khi triển khai thực tế.

- [Luật Giao dịch điện tử, bản hợp nhất 36/VBHN-VPQH ngày 13/03/2026](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/3/36-vbhn-vpqh.pdf): Điều 10-12, 22-23.
- [Nghị định 23/2025/NĐ-CP](https://vanban.chinhphu.vn/?docid=212829&pageid=27160), có sửa đổi về thủ tục bởi [Nghị định 15/2026/NĐ-CP](https://chinhphu.vn/?docid=216649&pageid=27160).
- [Thông tư 15/2025/TT-BKHCN](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/8/15-bkhcn.pdf): yêu cầu phần mềm ký/kiểm tra và Phụ lục II.
- [Nghị định 30/2020/NĐ-CP](https://chinhphu.vn/default.aspx?docid=199378&pageid=27160): Điều 5 trong phạm vi áp dụng.
- [ADR 0001: Cấu hình biểu mẫu và đơn vị xử lý](0001-submission-workflow.md).
