# Đối chiếu và thử nâng bản sao development

Ngày 13/10/2026. `development:audit-upgrade` phục hồi một bản sao đã kiểm chứng, tạo database chuẩn từ migration hiện hành đến0022, đối chiếu cấu trúc, rồi tùy chọn thử0023/0024 và quay lại bản sao cũ. Không mở PostgreSQL trên volume nguồn, không chạy API/worker/mail hoặc dùng tài khoản sẵn có để thử nghiệp vụ. Dữ liệu sao chép vẫn là **EXISTING_DEVELOPMENT_UNCLASSIFIED**.

## Cách chạy và ranh giới

Từ thư mục project, Node22/Docker đang sẵn sàng:

```powershell
npm run development:audit-upgrade --workspace @student-service/api -- --preservation-run 02a62789-32c5-4e3a-a490-fbd19ddeba49
npm run development:audit-upgrade --workspace @student-service/api -- --preservation-run 02a62789-32c5-4e3a-a490-fbd19ddeba49 --rehearse-upgrade
```

Lệnh npm đã cấp cờ bắt buộc `--offline-development-only`. Chỉ nhận UUID của bản sao tại project/run/offline-development; không nhận đường dẫn, DATABASE_URL hoặc tên nguồn tùy ý. Từ chối cấu hình DB/storage kế thừa và production. Bản sao phải có đủ5 nhóm kiểm chứng, cleanup=true, sourceModified=false và preservationStatus VERIFIED_PREUPGRADE_COPY. Hash/size dump phải đúng; bản dump được sao chép có giới hạn, tạo độc quyền vào lượt thử riêng trước khi phục hồi.

Nguồn student-service-postgres vẫn exited, cùng ID/image digest với bản sao; mọi container đang ghi volume nguồn chặn lệnh. Các cluster thử chỉ dùng tmpfs512MiB, image đúng digest, cổng loopback ngẫu nhiên khác5433/5434, giới hạn768MiB/1CPU mỗi container. Kiểm tra tên/ID/UUID-label/image/mount/cổng trước thao tác và dọn. Không mount volume nguồn. Artifact mới chỉ ở project/run/development-upgrade/UUID, bị Git bỏ qua; không tạo backup/khóa ngoài project.

## Khác biệt legacy đã xác định

23 migration0000–0022 khớp hash/timestamp. Record id3, timestamp1788422683657, hash `a8f239a60d54744ce6019b4be0b8dfdb96b50e13050ca8cb49b8bfcf10c8105e` không có trong journal. Chưa tìm lại được SQL lịch sử; **không kết luận SQL đó chỉ tạo một bảng**.

Trong các object/schema được đối chiếu, cấu trúc bản sao bằng database canonical đến0022 cộng đúng bảng account_activation_tokens:6 cột,3 constraint,3 index gồm account_activation_tokens_user_id_idx; bảng đang0 dòng. Mô hình DDL legacy nằm riêng trong hợp đồng audit để dựng cấu trúc kỳ vọng, không thêm vào migration journal hoặc giả làm migration lịch sử được khôi phục.

Phép đối chiếu gồm bảng, cột/default/not-null/identity/generated, hàm và định nghĩa, enum/domain, view, policy, index/constraint/trigger/extension. Bổ sung RLS/force-RLS, persistence/replica identity/reloptions, định nghĩa sequence, constraint validated/deferrable, index valid/ready/live, trigger enabled, collation và vị trí extension. Row hash/count và trạng thái sequence được kiểm riêng, không dùng dữ liệu mặc định của database canonical để thay dữ liệu cũ. Thử thật trên clone đổi RLS, tắt trigger, validate constraint và đổi sequence; cả4 nhóm được phát hiện, sau dọn probe snapshot trở lại baseline chính xác.

Chỉ nhận đúng ledger legacy24 record theo thứ tự/id/hash/timestamp đã quan sát hoặc canonical prefix23 record; cấu trúc sai khác sẽ chặn trước nâng. Công cụ `development:verify-upgrade` cũ **vẫn giữ guard canonical nghiêm ngặt**, không tự bỏ qua record lạ. Đây là nhánh audit/rehearsal có đối chiếu đầy đủ trên bản sao, chưa là công cụ nâng nguồn.

## Kết quả kiểm chứng

Run `dbe93150-0a67-43b2-9ac2-1e0153391a43` đạt **PRIVATE_UPGRADE_PASS**,8 nhóm kiểm chứng và cleanup=true:

- Phục hồi dump khớp toàn bộ baseline đã kiểm chứng; schema trước nâng khớp canonical cộng đúng cấu trúc legacy.
- Nâng0023/0024:27→31 bảng,24→26 record ledger. Toàn bộ24 record cũ giữ nguyên id/hash/timestamp, kể cả record lạ; chỉ nối đúng2 record mới. Bảng legacy giữ nguyên.
- Mọi row cũ giữ nguyên. Chỉ thêm1 permission document.retry và1 role_permission của SYSTEM_ADMIN;4 bảng registry mới trống. Sequence permissions60→61 là đúng một nextval của0024, các sequence ứng dụng khác không đổi. Không reset sequence để che thay đổi; guard cũng xử lý trạng thái sequence chưa từng gọi hoặc migration đã áp, và từ chối tăng thêm/thiếu sequence.
- Schema sau nâng khớp canonical0024 cộng cấu trúc legacy đã giữ. Xóa riêng clone đã nâng, phục hồi dump cũ vào cluster rollback mới; toàn bộ snapshot chi tiết/row/sequence/ledger trở lại baseline trước nâng. Nguồn vẫn exited, dump gốc và bản sao riêng cùng hash đã ghi.

14 bài guard đạt. Toàn bộ chuỗi test:recovery đạt261 ca (20 fixture,213 recovery/archive/encryption,14 demo guard,14 offline/upgrade guard). Không đổi schema/route ứng dụng, không tuyên bố chạy lại306 integration hoặc trình duyệt trong mốc này. Các lượt906c đầu thiếu index legacy kỳ vọng và03ecc dừng do guard sequence quá nghiêm được giữ báo cáo FAILED; không sửa thành đạt. Lượt59498 đạt trước khi thêm kiểm chứng rollback; bằng chứng cuối làdbe93150.

## Giới hạn và bước tiếp theo

Bằng chứng dùng bản sao ngày13/10 đã giữ, không tự chứng minh nguồn không đổi từ thời điểm đó chỉ bằng trạng thái exited. Khi nâng nguồn thật cần lấy/đối chiếu lại bản sao trong thời gian dừng ghi. Phép thử không hỗ trợ mọi object/global role/tablespace/owner/ACL PostgreSQL; dump không owner/ACL, không phải backup ngoài thiết bị hoặc chứng minh production. DDL lịch sử bị thiếu vẫn chưa khôi phục.

Chưa migrate nguồn hoặc thay server mặc định sang vault. Tiếp nối factory runtime có cấu hình cố định, deployment bất biến, kiểm tra schema/kho/readiness và đường quay lại; thử Word/PDF bằng hồ sơ giả riêng trước khi chuyển development. Demo workspace01233 tại127.0.0.6:3021 vẫn độc lập và không bị reset/checker tiêu thụ lại.
