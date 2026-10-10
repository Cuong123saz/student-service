# Dữ liệu giả đúng kiểu cho diễn tập phục hồi

Ngày 10/10/2026. Chỉ áp dụng cho thủ tục `DRILL_SERVICE` và database/kho riêng do runner tạo. Giấy xác nhận sinh viên vẫn thực hiện trực tiếp ở CTSV.

## Hợp đồng dữ liệu

`apps/api/scripts/recovery-fixture.mjs` dùng bốn trường PROFILE theo allowlist của ứng dụng: fullName, studentCode, classCode, facultyCode. Chủ hồ sơ giả là Nguyễn Minh An (giả định), mã `GIA240001`; tài khoản sinh viên thứ hai dùng `GIA240002`. Mã người dùng/đơn vị/phiên bản là UUID sinh mới; serviceId, revision và số lần gửi giữ kiểu số của API/database. Không dùng thông tin sinh viên thật hoặc gửi email.

| Kiểu     | Trường sinh viên khai | Lần 1                   | Lần 2                   |
| -------- | --------------------- | ----------------------- | ----------------------- |
| TEXT     | reference             | `TEST-2026-001`         | `TEST-2026-002`         |
| TEXTAREA | purpose               | Mục đích giả định lần 1 | Mục đích giả định lần 2 |
| NUMBER   | completedCredits      | `0` (number)            | `15` (number)           |
| DATE     | neededOn              | `2026-10-10`            | `2026-10-11`            |
| SELECT   | purposeType           | `SCHOLARSHIP`           | `OTHER`                 |
| BOOLEAN  | instructionsReceived  | `false` (boolean)       | `true` (boolean)        |

DATE là chuỗi ngày lịch thật theo `YYYY-MM-DD`, SELECT dùng mã có trong options. NUMBER/BOOLEAN không dùng chuỗi `"0"`/`"false"`. Bốn trường hồ sơ do server tự điền, không gửi lên để ghi đè. Sau mỗi lần gửi đối chiếu toàn bộ values, snapshot hồ sơ và metadata minh chứng; số 0/false không được hiểu thành thiếu dữ liệu. Sau phục hồi đối chiếu lại views/lịch sử nguyên vẹn, gồm kiểu JSON và Unicode.

Hai minh chứng là PDF A4 một trang hợp lệ, tổng **5.218 byte**. Cách tạo và kiểm tra độc lập được ghi trong [README bộ PDF](../apps/api/scripts/fixtures/recovery/README.md). Cả hai có nhãn dữ liệu giả, không dấu/chữ ký; metadata giữ `signatureStatus=NOT_CHECKED`.

## Kiểm chứng

Lệnh riêng `npm run test:fixtures --workspace @student-service/api` chạy 20 test bằng chính `procedureConfigSchema`, `validateProcedureConfig`, `validateAnswers`, `completionIssues` và `inspectEvidence` của ứng dụng. Kiểm tra schema fixture tắt coercion để không cho chuỗi giả làm số/boolean; không sửa cấu hình API production. Các test này được thêm vào `test:recovery`, nên chạy cả trong pipeline kiểm thử sẵn có.

Lượt đầy đủ `eb48374d-b029-48da-ace7-7b1f59cf42e2` chạy qua lệnh [mã hóa trên D](encrypted-recovery.md#chạy-lại-tại-máy-này), gồm 20 test fixture + 94 test gói/guard, build API, tạo hồ sơ giả qua API, mã hóa, xóa database nguồn giả và phục hồi từ gói mã hóa trên D. Kết quả `PASS`, cleanup thành công:

| Nội dung             | Kết quả                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| HTTP                 | 50 yêu cầu: 30×200, 1×401, 2×403, 9×404, 7×422, 1×503 cố ý gây ra                                                      |
| Giá trị sai          | Số/boolean dạng chuỗi, ngày không tồn tại, lựa chọn ngoài options, số trong TEXT, ghi đè PROFILE và key lạ đều trả 422 |
| Không ghi khi sai    | Đọc lại hồ sơ sau bảy lần thử sai: values và revision không đổi                                                        |
| Gói                  | Dump 112.698 byte; 2 PDF tổng 5.218 byte                                                                               |
| Kho                  | `D:\student-service-fake-encrypted-backups\eb48374d-b029-48da-ace7-7b1f59cf42e2`                                       |
| Đối chiếu            | 26 bảng, 4 sequence, chỉ mục/ràng buộc/trigger/extension khớp                                                          |
| Kiểu sau phục hồi    | values và snapshots của cả hai lần gửi khớp; PDF tải về đúng byte/hash                                                 |
| Nghiệp vụ/quyền      | Lịch sử/thông báo, ghi tiếp, idempotency và thu hồi quyền đều đạt                                                      |
| Tổng thời gian local | 20.756 ms; không suy ra thời gian cho dữ liệu thật                                                                     |

Báo cáo local: `run/recovery-drills/eb48374d-b029-48da-ace7-7b1f59cf42e2/report.json`. Log: `run/typed-fixture-encrypted-recovery.log`. Lint các script thay đổi và format/diff/ADR gate được kiểm tra. Không thay source ứng dụng, schema database hoặc giao diện; không chạy lại toàn bộ hồi quy ứng dụng.

Đúng kiểu là điều kiện tối thiểu. Bộ mẫu nhỏ này chưa chứng minh năng lực chịu tải, dữ liệu thực tế đầy đủ hoặc hiệu lực giấy tờ. Upload vẫn dùng cơ chế nhận dạng định dạng hiện có, chưa phân tích PDF hoàn chỉnh hay xác minh chữ ký. Các byte tối thiểu trong unit test riêng vẫn được giữ khi chúng chỉ kiểm tra guard/metadata; không dùng chúng để kết luận PDF mở được.
