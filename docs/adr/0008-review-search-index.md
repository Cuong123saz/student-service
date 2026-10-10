---
status: Accepted
date: 2026-10-10
---

# ADR 0008: Chỉ mục tìm kiếm hàng đợi

Tiếp tục yêu cầu cải thiện phần tìm kiếm sau kiểm tra đồng thời. Giữ nguyên ADR0004–0007: tìm substring literal không phân biệt hoa/thường nhưng giữ dấu, trên fullName/studentCode của snapshot đã gửi và serviceName đóng băng; không tìm câu trả lời, lý do, tệp hoặc bản đang sửa. Quyền hiện tại lọc trước seek/limit, thứ tự submittedAt/id, cursor gắn người/bộ lọc và hợp đồng hai cổng giữ nguyên. Đây là quyết định kỹ thuật local, không phải nghiệm thu, triển khai production hay đóng sprint.

## Căn cứ và lựa chọn

Profiler gọi repository thật, thu đúng SQL page qua logger Drizzle rồi EXPLAIN ANALYZE/BUFFERS trên DB test10.000 hồ sơ. Baseline tìm LOAD06999 mất18.667ms, seq scan loại9.999 dòng,851 shared buffer hits; trang đầu0.215ms, đọc21 dòng,8 hits. Với pool10,20 worker có p95 chờ đến callback giao dịch129.18ms (bao gồm BEGIN/network, không gọi là thời gian chờ pool thuần). Không tăng pool khi truy vấn đang scan.

Migration0020 thêm pg_trgm (CREATE EXTENSION IF NOT EXISTS) và một GIN nhiều cột trên các biểu thức (student_snapshot->>'fullName'), (student_snapshot->>'studentCode') và service_name, mỗi cột dùng gin_trgm_ops. Query giữ OR ILIKE hiện tại; planner tự chọn bitmap/index/scan, không ép enable_seqscan hoặc thay độ tương đồng. Không gộp chuỗi để tránh kết quả khớp xuyên ranh giới trường. Btree phân trang0019 giữ lại để phục vụ thứ tự và tìm kiếm rộng/ngắn. Không thêm search engine hoặc dữ liệu sao chép.

Theo [PostgreSQL17 pg_trgm](https://www.postgresql.org/docs/17/pgtrgm.html), GIN hỗ trợ ILIKE nhưng mẫu không có trigram có thể phải scan cả index. [GIN nhiều cột](https://www.postgresql.org/docs/17/indexes-multicolumn.html) dùng được với từng tập con cột. Không hứa cải thiện mọi từ khóa, đặc biệt1–2 ký tự hoặc chuỗi ký hiệu như50%_. Chi phí đổi lại: dung lượng chỉ mục và cập nhật khi snapshot/thủ tục được ghi. Extension không lưu bản sao câu trả lời hay nới quyền đọc dữ liệu.

## Triển khai và kiểm chứng

ADR này commit trước migration0020; bổ sung cổng ADR để yêu cầu quyết định này cho migration submissions. Drizzle schema/snapshot/journal đồng bộ. Không sửa migration cũ. Migration thường chạy trong transaction và có thể khóa ghi khi tạo GIN; chỉ áp dụng local sau kiểm chứng. Môi trường dùng chung cần cửa sổ bảo trì, quyền cài extension và đo build/write/storage trước khi chọn triển khai. Không tự gỡ extension khi rollback vì có thể được chỉ mục khác dùng; phương án quay lui hiệu năng là DROP riêng chỉ mục mới trong migration tiếp theo.

Đối chiếu trước/sau cùng công cụ, cùng dataset/phân quyền/pool/workload, ghi SQL plan, HTTP và thời gian giao dịch riêng. Kiểm tra mã/tên/thủ tục, tiếng Việt có dấu, literal %, _, gạch chéo ngược, từ ngắn, tìm rộng, trang sâu có tìm kiếm, và quyền/designated/foreign/self trước limit. Migration test giữ nguyên dữ liệu/audit/grants/config, đúng index và extension. Chỉ nâng cấp DB development khi build/typecheck/lint và các regression liên quan đạt; đối chiếu dữ liệu cũ trước/sau, giữ STUDENT_CONFIRMATION OFFLINE tại CTSV. Kết quả thực thi và giới hạn ghi riêng, không đưa số dự kiến thành số đo.

## Bổ sung sau thí nghiệm pending list, trước migration0021

Migration0020 đã thử trên DB test; không sửa file đã áp dụng. Sau bulk insert, GIN mặc định fastupdate=on có83 trang pending; tìm mã vẫn seq scan16.03ms. Gọi gin_clean_pending_list trong thí nghiệm riêng làm truy vấn thật dùng GIN, giảm còn0.586ms. Không đưa thao tác bảo trì này vào request API hoặc âm thầm làm sạch trước mọi lần benchmark.

Migration0021 chỉ ALTER INDEX submissions_queue_search_idx SET (fastupdate=off) và dọn pending hiện có một lần. Ưu tiên đọc ổn định cho dữ liệu snapshot ít đổi, chấp nhận ghi index trực tiếp tốn công hơn; không đổi pool, autovacuum toàn hệ thống hoặc bỏ bớt kết quả. Schema/snapshot ghi fastupdate=false. Cần đo thao tác ghi và seed/storage cùng số đo đọc; chưa đủ cơ sở khẳng định throughput ghi ở production. Theo [PostgreSQL17 GIN fast update](https://www.postgresql.org/docs/17/gin.html#GIN-FAST-UPDATE), pending entries làm chậm đọc; có thể tắt fastupdate khi ưu tiên độ ổn định phản hồi hơn tốc độ cập nhật. ADR bổ sung này commit trước0021; migration0020 vẫn giữ nguyên.
