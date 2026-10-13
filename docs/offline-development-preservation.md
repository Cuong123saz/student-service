# Giữ và kiểm chứng bản sao development trước khi nâng kho tài liệu

Ngày12/10/2026. Lệnh `npm run development:preserve-offline --workspace @student-service/api` chỉ dành cho database development đã dừng. Không mở nguồn, migrate, seed, khởi động worker hoặc gửi thư. Dữ liệu nguồn hiện có được ghi **EXISTING_DEVELOPMENT_UNCLASSIFIED**, không tự gán dữ liệu thật thành dữ liệu giả. Các bài guard dùng fixture giả; phép thử đổi cột/hàm chỉ thực hiện trên database phục hồi riêng.

## Ranh giới và trình tự

- Bắt buộc cờ `--offline-development-only`, Node22; từ chối DATABASE_URL/SUBMISSION_STORAGE_ROOT kế thừa và APP_ENV=production. Đọc cấu hình development cục bộ, chỉ chấp nhận database student_service trên loopback5433/user postgres. Không in mật khẩu, dotenv hoặc lỗi driver thô.
- Nguồn phải đúng container student-service-postgres, trạng thái exited, volume student-service-api_student_service_data tại vị trí PostgreSQL và image17-alpine. Ghi nhận ID/image digest; mọi lần kiểm tra sau phải cùng nguồn. Bất kỳ container đang ghi volume nguồn đều chặn thao tác.
- Reader riêng có root filesystem chỉ đọc, không mạng, volume nguồn chỉ đọc; từ chối symlink và entry khác file/thư mục trong PGDATA. Đè volume mặc định của image bằng tmpfs riêng để không tạo volume ẩn. Không chạy PostgreSQL trên nguồn.
- Lưu tar vật lý vào run/offline-development/UUID trong project; giới hạn450MiB, tạo độc quyền, fsync và đọc lại SHA. Đọc lại nguồn hai lần nữa để xác nhận byte tar không đổi. Đây không phải cam kết chịu mất điện hoặc kiểm chứng fsync thư mục.
- Mở tar trong clone riêng với tmpfs512MiB, image đúng digest nguồn và cổng loopback ngẫu nhiên. PostgreSQL clone tự phục hồi WAL nếu cần; byte nguồn không đổi. Không tự đổi mật khẩu nguồn.
- Giữ tất cả minh chứng UUID và file mẫu vN/.gitattributes theo hash, giới hạn từng file5MiB/1MiB; không sửa hoặc tạo thư mục minh chứng nguồn khi thiếu. Audit trên bản sao xác nhận các tham chiếu. Nếu thiếu/hỏng hoặc có document registry chưa kèm output thì chỉ ghi DATABASE_ONLY_ATTENTION, không cho là sẵn sàng nâng hệ thống.
- Tạo pg_dump custom, không owner/ACL, rồi pg_restore vào cluster mới hoàn toàn, không ghi đè clone hoặc nguồn. Chờ PostgreSQL qua TCP, tránh nhầm server socket tạm của bước khởi tạo là database đã sẵn sàng.
- Đối chiếu mọi row theo JSONB ổn định, sequence, cột/default/not-null/identity/generated, hàm, enum/domain, view, policy, index, constraint, trigger và extension trong public/drizzle. Đổi cột/hàm giả trên target để kiểm tra snapshot phát hiện được, rồi xóa probe và đối chiếu lại baseline.
- Dọn riêng các container có ID/tên/UUID-label/image/mount đúng lượt này. Giữ tar/dump/assets/report trong run để dùng trước bước nâng. Không tự động khởi động lại các demo tmpfs cũ.

## Kết quả hiện tại

Run `8b033f97-de01-4080-8c6e-74debd9a6925` đạt **VERIFIED_PREUPGRADE_COPY**, cả5 nhóm kiểm chứng và cleanup=true. Nguồn vẫn exited:27 bảng,4 sequence,229 cột,225 hàm,85 index,116 constraint,7 trigger; không có enum/domain/view/policy ứng dụng trong lượt này. Không có hồ sơ hoặc minh chứng, document registry chưa bật; mẫu v1 và .gitattributes giữ đúng byte.

Tar67866112 byte/SHA256 `cbd911ed59648e63d7d9212fd3e716ccdc1c25d332c0fe9706616af5241466fa`; dump116821 byte/SHA256 `4ee44487b78be9681016d69209d5baae116017952b8e5f2d736e6f245146d2e8`. Bằng chứng bị Git bỏ qua: run/offline-development/UUID/report.json, source-digests.json, restored-digests.json, database-physical.tar, database.dump, files và templates. Chỉ mã công cụ/tài liệu được commit.

5 bài guard đạt; bản dựng ứng dụng/schema/route không đổi nên không tuyên bố đã chạy lại toàn bộ integration của ứng dụng. Lượt fe5d26ad trước khi thêm đối chiếu cột/hàm cũng phục hồi đạt. Các lượt dừng do guard volume mặc định, .gitattributes chưa được nhận diện và readiness socket được giữ báo cáo; không đổi lượt lỗi thành đạt. Volume ẩn của lượt đầu đã được xác minh riêng và dọn, nguồn giữ nguyên.

## Giới hạn và việc tiếp theo

Đây là bản sao trước nâng tại cùng ổ D, chưa mã hóa, không phải kho backup ngoài thiết bị hoặc format bundle dữ liệu giả của recovery rehearsal. Không cam kết hỗ trợ mọi object/global role/tablespace/ACL PostgreSQL; reader từ chối tablespace/WAL symlink và bản dump logical không giữ owner/ACL. Tar vật lý chỉ mở bằng đúng image nguồn đã ghi. Không dùng công cụ này để suy ra khả năng phục hồi production.

Tiếp thử migration và runtime có kho trên bản sao đã kiểm chứng, xác nhận dữ liệu nền giữ nguyên và bản Word/PDF mới chỉ dùng hồ sơ giả. Sau đó mới nâng cấu hình development có đường quay lại; chưa thay startup mặc định trong mốc này.

## Thử nâng cấp ngày13/10

Thêm `npm run development:verify-upgrade --workspace @student-service/api`. Luôn hoàn tất giữ/khôi phục/đối chiếu nguồn trước khi thử migration trên target riêng; source vẫn không mở hoặc migrate. Ledger phải khớp đúng prefix của journal/SQL hash, không chấp nhận record lạ, thiếu tiền nhiệm, đổi hash hoặc duplicate. Sau migration dự kiến đối chiếu dữ liệu cũ, chỉ cho thêm permission document.retry và role_permission của SYSTEM_ADMIN, giữ sequence ứng dụng và registry mới trống. Nhánh áp migration chưa được chứng minh trên development hiện tại do guard dừng trước đó; không gọi thử nâng nguồn là đạt.

Run `02a62789-32c5-4e3a-a490-fbd19ddeba49` có preservationStatus VERIFIED_PREUPGRADE_COPY, đủ5 nhóm giữ/phục hồi/source unchanged; upgrade REFUSED và cleanup=true trước migrate.24 record nguồn:23 record khớp hash/timestamp hiện tại, một record id3/timestamp1788422683657/hash a8f239a60d54744ce6019b4be0b8dfdb96b50e13050ca8cb49b8bfcf10c8105e không có trong journal. Không phải chênh LF/CRLF. Source còn bảng account_activation_tokens6 cột/ba constraint, hiện0 dòng; chưa chứng minh record lạ chỉ tạo bảng này. Không xóa record hoặc tự viết lại lịch sử, không nới guard để giả nâng thành công.8 bài guard fixture giả đạt.

Tiếp đối chiếu schema với database tạo mới từ canonical migration đến0022, xác định mọi khác biệt và đường nâng giữ nguyên record cũ; chỉ thử trên bản sao. Trong lúc này [demo mới trong project](workspace-vault-demo.md) dùng database giả riêng đã đạt, không phụ thuộc ledger development.
